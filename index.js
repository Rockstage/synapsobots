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

dotenv.config();

let DISCORD_BOT_TOKEN;
let DISCORD_APPLICATION_ID;
if (process.env.NODE_ENV === "development") {
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
  try {
    const browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process",
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "networkidle2" });

    const content = await page.evaluate((url) => {
      if (url.includes("notion")) {
        return document.querySelector(".notion-page-content").innerText;
      }
      return document.querySelector("body").innerText;
    }, url);

    await browser.close();
    return content;
  } catch (error) {
    console.error(`Error fetching webpage: ${error.message}`);
    return null;
  }
}

// Generate GPT Prompt based on conversation history, user message, and channel topic
const generatePrompt = async (channel, userMessage) => {
  // Set GPT System Prompt as channel topic's text or scraped link
  let systemPrompt = channel.topic || "You are a helpful assistant.";
  let link;
  if (channel.topic && channel.topic.match(/(https?:\/\/[^\s]+)/g)) {
    link = channel.topic.match(/(https?:\/\/[^\s]+)/g);
    try {
      sendMessage(channel, "Synapses seeking...");
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
    await channel.messages.fetch({ limit: 1 }).then((messages) => {
      const lastMessage = messages.first();
      deleteMessage(lastMessage);
    });
  }

  // Get conversation history from channel
  const fetchedMessages = await channel.messages.fetch({ limit: 100 });

  // Format conversation history
  const conversation = [
    ...fetchedMessages.map((message) => ({
      role: message.author.id === client.user.id ? "assistant" : "user",
      content: message.content,
    })),
  ];

  // Add system prompt from channel topic and latest user message
  conversation.push(
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userMessage,
    }
  );
  return conversation;
};

let isConnectedToDiscord = false;

client.once(Events.ClientReady, (c) => {
  console.log("Ready! Logged in as " + c.user.tag); // SynapsoBots#3788
  isConnectedToDiscord = true;
});

// Handle GPT Request and Response
async function gptStreamingResponse(prompt, message) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Ensure this is correctly set
  });

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: prompt,
      temperature: 0.3,
      stream: true,
    });

    let sentences = [];
    let currentSentence = "";
    const sentenceEndRegex = /[.!?](?=["']?$|\s*$)/;

    // Set the activeStreamController on the client object
    client.activeStreamController = stream.controller;

    for await (const part of stream) {
      if (
        part.choices &&
        part.choices.length > 0 &&
        part.choices[0].hasOwnProperty("delta")
      ) {
        const delta = part.choices[0].delta;
        if (delta && delta.content !== undefined) {
          currentSentence += delta.content;
          console.log("Delta content:", delta.content);

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
                await sendMessage(message.channel, part);
              }
            } else {
              await sendMessage(message.channel, completeSentence);
            }
          }
        } else {
          console.log("Delta content is undefined");
        }
      } else {
        console.log("Unexpected part structure:", part);
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
          await sendMessage(message.channel, part);
        }
      } else {
        await sendMessage(message.channel, remainingSentence);
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
async function gptResponse(prompt, message) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // This is also the default, can be omitted
  });
  try {
    sendMessage(message.channel, "Synapses tingling...");
    const response = await openai.chat.completions.create({
      model: "gpt-4-1106-preview", // 128,000 tokens context
      messages: prompt,
      // max_tokens: 2000,
      temperature: 0.3,
    });
    const content = response.choices[0].message.content;
    await message.channel.messages.fetch({ limit: 1 }).then((messages) => {
      const lastMessage = messages.first();
      deleteMessage(lastMessage);
    });

    // Send response to Discord
    if (content.length > 2000) {
      let parts = splitResponse(content);
      let delay = 0;
      parts.forEach(async (part) => {
        setTimeout(async () => {
          sendMessage(message.channel, part);
        }, delay);
        delay += 1000;
      });
    } else {
      sendMessage(message.channel, content);
    }
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      console.error(error.status); // e.g. 401
      console.error(error.message); // e.g. The authentication token you passed was invalid...
      console.error(error.code); // e.g. 'invalid_api_key'
      console.error(error.type); // e.g. 'invalid_request_error'
      return "My synapses misfired... Please try again.";
    } else {
      // Non-API error
      console.log(error);
    }
  }
}

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

async function sendMessage(channel, content) {
  try {
    await channel.send(content);
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

  console.log("User Message: ", message.content);

  const { channel, content } = message;

  try {
    const prompt = await generatePrompt(channel, content);
    await gptStreamingResponse(prompt, message);
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
