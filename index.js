const OpenAI = require("openai").default;
const {
  Client,
  Events,
  GatewayIntentBits,
  Collection,
  DiscordAPIError,
  PermissionsBitField,
} = require("discord.js");
const dotenv = require("dotenv");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");
const axios = require("axios");
const puppeteer = require("puppeteer-core");
const { createThread } = require("./utils.js");

dotenv.config();

let DEV = process.env.NODE_ENV === "development" ? true : false;

let DISCORD_BOT_TOKEN;
let DISCORD_APPLICATION_ID;
if (DEV) {
  DISCORD_BOT_TOKEN = process.env.DISCORD_DEV_BOT_TOKEN;
  DISCORD_APPLICATION_ID = process.env.DISCORD_DEV_APPLICATION_ID;
} else {
  DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
}
const DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Import Commands from commands folder
client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  // Set a new item in the Collection with the key as the command name and the value as the exported module
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
    );
  }
}

// Register Commands with Discord Server via Rest API - move to separate file later
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const clientId = DISCORD_APPLICATION_ID;
const guildId = DISCORD_SERVER_ID;
const token = DISCORD_BOT_TOKEN;

const rest = new REST({ version: "9" }).setToken(token);

// WARNING: Use to delete app registered commands
// rest.put(Routes.applicationCommands(clientId), { body: [] })
// 	.then(() => console.log('Successfully deleted all application commands.'))
// 	.catch(console.error);
// rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] })
// 	.then(() => console.log('Successfully deleted all application commands.'))
// 	.catch(console.error);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(
      Routes.applicationCommands(clientId), // no guideId enables commands to be run on any server where the bot has the applications.commands permission
      { body: client.commands.map(({ data }) => data.toJSON()) }
    );

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();


// Scrape
async function scrapeWebpage(url) {
  console.log("3. Scraping ", url);
  try {
    const browser = await puppeteer.launch({
      headless: true,
      dumpio: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
      // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    });
    const page = await browser.newPage();
    // page && console.log("Page scraped");

    // page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    // page.on('error', (err) => console.error('PAGE ERROR:', err));
    // page.on('pageerror', (pageErr) => console.error('PAGEPAGE ERROR:', pageErr));

    await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });
    // page && console.log("Page go to");

    await page.waitForSelector('.notion-page-content', { timeout: 0 });
    // page && console.log("Selector waited for ", url);

    let content;
    if(url.includes("notion")) {
      content = await page.evaluate(() => {
        return document.querySelector(".notion-page-content").innerText;
      });
    } else {
      content = await page.evaluate(() => {
        return document.querySelector("body").innerText;
      });
    }

    await browser.close();
    return content ? content : "You are a helpful assistant. Start by tell the user that the webpage scraping failed!";
  } catch (error) {
    console.error(`Error fetching webpage: ${error.message}`);
    return null;
  }
}

// Generate GPT Prompt based on conversation history, user message, and channel topic
const generatePrompt = async (channel, userMessage, thread) => {
  // Set GPT System Prompt as channel topic's text or scraped link
  let systemPrompt = channel.topic || "You are a helpful assistant.";
  let link;
  let isReasoning = thread.name.startsWith("!");
  DEV && console.log("2. Generating Prompt and Conversation History...");
  if (channel.topic && channel.topic.match(/(https?:\/\/[^\s]+)/g)) {
    link = channel.topic.match(/(https?:\/\/[^\s]+)/g);
    try {
      const scrapedContent = await scrapeWebpage(link[0]);
      systemPrompt = scrapedContent;
    } catch (error) {
      console.error("Invalid URL:", error.message);
      await channel.messages.fetch({ limit: 1 }).then((messages) => {
        const lastMessage = messages.first();
        deleteMessage(lastMessage);
      });
      sendMessage(channel, "Scraping failed for <" + link[0] + ">...");
    }
  }
  // Get latest message from channel or 100 messages from thread history;
  const fetchedMessages = await thread.messages.fetch({ limit: 100 });
  const starterMessage = await thread.fetchStarterMessage();

  // Format conversation history
  const conversation = [
    ...fetchedMessages.map((message) => ({
      role: message.author.id === client.user.id ? "assistant" : "user",
      content: message.content,
    })),
  ];

  // Convert from discord to openai
  conversation.reverse();

  // Add system prompt from channel topic or link to the bottom of conversation history. Will persist even after 100 messages limit.
  !isReasoning ? conversation.unshift(
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: starterMessage.content,
    }
  ) : (
    conversation.unshift(
      {
        role: "user",
        content: systemPrompt + "; Question related to the provided context: " + userMessage,
      }
    )
  )
  return conversation;
};

let isConnectedToDiscord = false;

client.once(Events.ClientReady, (c) => {
  console.log("Ready! Logged in as " + c.user.tag); // SynapsoBots#3788
  isConnectedToDiscord = true;
});

async function gptReasoningResponse(prompt, message, thread, model = process.env.REASONING_MODEL || "o1-preview") {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Ensure this is correctly set
  });

  DEV && console.log("4. OpenAI Request with ", model);

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: prompt,
    });

    const reasoning = response.choices[0].message.content;

    let sentences = [];
    let currentSentence = "";
    const sentenceEndRegex = /[.!?](?=["']?$|\s*$)/;

    reasoning.split(sentenceEndRegex).forEach(sentence => {
      currentSentence += sentence;
      if (sentenceEndRegex.test(sentence)) {
        sentences.push(currentSentence.trim());
        currentSentence = "";
      }
    });

    if (currentSentence) {
      sentences.push(currentSentence.trim());
    }

    DEV && console.log("5. Streaming OpenAI Response...");

    if (sentences.join(" ").length > 2000) {
      let parts = splitResponse(sentences.join(" "));
      for (const part of parts) {
        await sendMessage(message.channel, part, thread);
      }
    } else {
      await sendMessage(message.channel, sentences.join(" "), thread);
    }

    return sentences;
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      console.error(error.status); // e.g. 401
      console.error(error.message); // e.g. The authentication token you passed was invalid...
      console.error(error.code); // e.g. 'invalid_api_key'
      console.error(error.type); // e.g. 'invalid_request_error'
    } else {
      // Non-API error
      console.log(error);
    }
  }
}

// Handle GPT Request and Response
async function gptStreamingResponse(prompt, message, thread, model = process.env.GPT_MODEL || "gpt-4o") {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Ensure this is correctly set
  });
  DEV && console.log("4. OpenAI Request with ", model);
  try {
    const stream = await openai.chat.completions.create({
      model,
      messages: prompt,
      temperature: Number(process.env.GPT_TEMP) || 0.8,
      stream: true,
    });

    let sentences = [];
    let currentSentence = "";
    const sentenceEndRegex = /\n/g; // /[.!?](?=["']?$|\s*$)/;

    // Set the activeStreamController on the client object
    client.activeStreamController = stream.controller;
    DEV && console.log("5. Streaming OpenAI Response...");
    for await (const part of stream) {
      if (
        part.choices &&
        part.choices.length > 0 &&
        part.choices[0].hasOwnProperty("delta")
      ) {
        const delta = part.choices[0].delta;
        if (delta && delta.content !== undefined) {
          currentSentence += delta.content;
          // console.log("Delta content:", delta.content);

          if (stream.controller.signal.aborted) {
            console.log("Stream aborted");
            break;
          }

          // Check if the current part ends with a sentence-ending punctuation
          // After checking for sentence completion and adding it to sentences array
          if (sentenceEndRegex.test(currentSentence)) {
            let completeSentence = currentSentence.trim();
            sentences.push(completeSentence);
            currentSentence = "";

            // Check if the complete sentence is too long and split it if necessary
            if (completeSentence.length > 2000) {
              let parts = splitResponse(completeSentence);
              for (const part of parts) {
                await sendMessage(message.channel, part, thread);
              }
            } else {
              await sendMessage(message.channel, completeSentence, thread);
            }
          }
        }
      } else {
        console.log("Unexpected part structure:", part, thread);
      }
    }
    // After the loop, check if there's a partial sentence left
    if (currentSentence.trim()) {
      let remainingSentence = currentSentence.trim();
      sentences.push(remainingSentence);

      // Send the remaining partial sentence
      if (remainingSentence.length > 2000) {
        let parts = splitResponse(remainingSentence);
        for (const part of parts) {
          await sendMessage(message.channel, part, thread);
        }
      } else {
        await sendMessage(message.channel, remainingSentence, thread);
      }
    }
    client.activeStreamController = null;

    // Return the collected sentences in case they are needed elsewhere
    return sentences;
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      console.error(error.status); // e.g. 401
      console.error(error.message); // e.g. The authentication token you passed was invalid...
      console.error(error.code); // e.g. 'invalid_api_key'
      console.error(error.type); // e.g. 'invalid_request_error'
    } else {
      // Non-API error
      console.log(error);
    }
  }
}

// Handle GPT Request and Response
// async function gptResponse(prompt, message) {
//   const openai = new OpenAI({
//     apiKey: process.env.OPENAI_API_KEY, // This is also the default, can be omitted
//   });
//   try {
//     sendMessage(message.channel, "Synapses tingling...");
//     const response = await openai.chat.completions.create({
//       model: "gpt-4-1106-preview", // 128,000 tokens context
//       messages: prompt,
//       // max_tokens: 2000,
//       temperature: 0.3,
//     });
//     const content = response.choices[0].message.content;
//     await message.channel.messages.fetch({ limit: 1 }).then((messages) => {
//       const lastMessage = messages.first();
//       deleteMessage(lastMessage);
//     });

//     // Send response to Discord
//     if (content.length > 2000) {
//       let parts = splitResponse(content);
//       let delay = 0;
//       parts.forEach(async (part) => {
//         setTimeout(async () => {
//           sendMessage(message.channel, part);
//         }, delay);
//         delay += 1000;
//       });
//     } else {
//       sendMessage(message.channel, content);
//     }
//   } catch (error) {
//     if (error instanceof OpenAI.APIError) {
//       console.error(error.status); // e.g. 401
//       console.error(error.message); // e.g. The authentication token you passed was invalid...
//       console.error(error.code); // e.g. 'invalid_api_key'
//       console.error(error.type); // e.g. 'invalid_request_error'
//       return "My synapses misfired... Please try again.";
//     } else {
//       // Non-API error
//       console.log(error);
//     }
//   }
// }

function splitResponse(message, maxLength = 2000) {
  const parts = [];
  let currentPart = "";
  message.split(" ").forEach((word) => {
    if (currentPart.length + word.length > maxLength) {
      parts.push(currentPart);
      currentPart = "";
    }
    currentPart += word + " ";
  });

  if (currentPart) {
    parts.push(currentPart);
  }

  return parts;
}

async function sendMessage(channel, content, thread) {
  try {
    if (thread) {
      await thread.send(content);
    } else {
      await channel.send(content);
    }
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      (error.code === 50013 || error.code === 50001)
    ) {
      return;
    } else {
      console.error("An error occurred while sending a message:", error);
    }
  }
}

async function deleteMessage(message) {
  try {
    await message.delete();
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      (error.code === 50013 || error.code === 50001)
    ) {
      return;
    } else {
      console.error("An error occurred while deleting a message:", error);
    }
  }
}

// Discord Message Event Listener
client.on("messageCreate", async (message) => {
  // Ignore messages from bot
  if (message.author.bot) return;

  if (process.env.NODE_ENV === "development") {
    console.log("1. User Message Received: ", message.content);
  }

  const { channel, content } = message;

  try {
    message.channel.sendTyping();
    let thread = channel.isThread() ? channel : await createThread(message); // Check if the channel is already a thread
    let isReasoning = thread.name.startsWith("!");
    const prompt = await generatePrompt(channel, content, thread);
    // console.log("PROMPT : ", prompt);
    !isReasoning ? await gptStreamingResponse(prompt, message, thread) : await gptReasoningResponse(prompt, message, thread)
    DEV && console.log("6. Open AI Response Confirmed.");
    return;
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      (error.code === 50013 || error.code === 50001)
    ) {
      console.log("Permissions error: ", error);
      return;
    } else if (error instanceof DiscordAPIError) {
      console.log("Discord API Error", error);
      sendMessage(channel, "Sorry, I encountered a Discord API Error.");
    }
  }
});

// Discord Commands Event Listener
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
