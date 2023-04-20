const { Configuration, OpenAIApi } = require('openai');
const { Client, Events, GatewayIntentBits, Collection, DiscordAPIError, PermissionsBitField } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const axios = require('axios');
const puppeteer = require('puppeteer');

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID;
const openAiConfig = new Configuration({
    apiKey: OPENAI_API_KEY,
  });

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Import Commands from commands folder
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	// Set a new item in the Collection with the key as the command name and the value as the exported module
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}


// Register Commands with Discord Server via Rest API - move to separate file later
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const clientId = DISCORD_APPLICATION_ID;
const guildId = DISCORD_SERVER_ID;
const token = DISCORD_BOT_TOKEN;

const rest = new REST({ version: '9' }).setToken(token);

// WARNING: Use to delete app registered commands
rest.put(Routes.applicationCommands(clientId), { body: [] })
	.then(() => console.log('Successfully deleted all application commands.'))
	.catch(console.error);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(clientId), // no guideId enables commands to be run on any server where the bot has the applications.commands permission
            { body: client.commands.map(({ data }) => data.toJSON()) },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

// Scrape
async function scrapeWebpage(url) {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();

        await page.goto(url, { waitUntil: 'networkidle2' });

        const content = await page.evaluate((url) => {
            if (url.includes("notion")) {
                return document.querySelector('.notion-page-content').innerText;
            }
            return document.querySelector('body').innerText;
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
    let systemPrompt = channel.topic;
    const link = channel.topic.match(/(https?:\/\/[^\s]+)/g) || null;
    if (link) {
        try {
            sendMessage(channel, "Synapses seeking...");
            const scrapedContent = await scrapeWebpage(link[0]);
            systemPrompt = scrapedContent;
        } catch (error) {
            console.error('Invalid URL:', error.message);
            await channel.messages.fetch({ limit: 1 }).then(messages => {
                const lastMessage = messages.first();
                deleteMessage(lastMessage);
            });
            sendMessage(channel, "Scraping failed for <" + link[0] + ">...");
        }
        await channel.messages.fetch({ limit: 1 }).then(messages => {
            const lastMessage = messages.first();
            deleteMessage(lastMessage);
        });
    }

    // Get conversation history from channel
    const fetchedMessages = await channel.messages.fetch({ limit: 10 });

    // Format conversation history
    const conversation = [
        ...fetchedMessages
            .map(message => ({
                role: message.author.id === client.user.id ? 'assistant' : 'user', 
                content: message.content}))
    ];

    // Add system prompt from channel topic and latest user message
    conversation.push(
        {
            role: 'system',
            content: systemPrompt,
        },
        {
            role: 'user',
            content: userMessage,
        }
    );
    return conversation
};

client.once(Events.ClientReady, c => {
    console.log('Ready! Logged in as ' + c.user.tag); // SynapsoBots#3788
});

// Handle GPT Request and Response
async function gptResponse(prompt) {
    const openai = new OpenAIApi(openAiConfig);
    try {
        const response = await openai.createChatCompletion({
            model: 'gpt-4',
            messages: prompt,
            max_tokens: 2000,
            temperature: 0.3,
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.log("OpenAI Api Error", error.response.data.error.message);
        throw error
    }
}

function splitResponse(message, maxLength = 2000) {
    const parts = [];
    let currentPart = "";
    message.split(" ").forEach(word => {
        if (currentPart.length + word.length > maxLength) {
            parts.push(currentPart);
            currentPart = "";
        }
        currentPart += word + " ";
    });

    if(currentPart) {
        parts.push(currentPart);
    }

    return parts;
}

async function sendMessage(channel, content) {
    try {
        await channel.send(content);
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50013) {
          return
        } else {
          console.error("An error occurred while sending a message:", error);
        }
      }
}

async function deleteMessage(message) {
    try {
        await message.delete();
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50013) {
          return
        } else {
          console.error("An error occurred while deleting a message:", error);
        }
      }
}

// Discord Message Event Listener
client.on('messageCreate', async message => {
    // Ignore messages from bot
    if (message.author.bot) return;
  
    // Send user message and channel to OpenAI
    const { channel, content } = message;
    try {
      const prompt = await generatePrompt(channel, content);
      sendMessage(channel, "Synapses tingling...");
      const response = await gptResponse(prompt);
  
      await message.channel.messages.fetch({ limit: 1 }).then(messages => {
        const lastMessage = messages.first();
        deleteMessage(lastMessage);
      });
  
      // Send response to Discord
      if (response.length > 2000) {
        let parts = splitResponse(response);
        let delay = 0;
        parts.forEach(async (part) => {
          setTimeout(async () => {
            sendMessage(channel, part);
          }, delay);
          delay += 1000;
        });
      } else {
        sendMessage(channel, response);
      }
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 50013) {
        return;
      } else if (error instanceof DiscordAPIError) {
        console.log("Discord API Error", error);
        sendMessage(channel, "Sorry, I encountered a Discord API Error.");
      }
    }
});

// Discord Commands Event Listener
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    // TODO: If bot doesn't have view channel permission, return;
    // console.log("Interaction: ", interaction);
    // const botPermissions = interaction.channel.permissionsFor(client.user);
    // console.log("Bot Permissions: ", botPermissions.has(PermissionsBitField.Flags.ViewChannel));
    // if (!botPermissions.has(PermissionsBitField.Flags.ViewChannel)) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});

client.login(DISCORD_BOT_TOKEN);