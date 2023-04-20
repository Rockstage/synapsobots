const { Configuration, OpenAIApi } = require('openai');
const { Client, Events, GatewayIntentBits, Collection, DiscordAPIError, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');

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

// Handle Commands
client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const clientId = DISCORD_APPLICATION_ID;
const guildId = DISCORD_SERVER_ID;
const token = DISCORD_BOT_TOKEN;

const rest = new REST({ version: '9' }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: client.commands.map(({ data }) => data.toJSON()) },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

const conversationHistory = new Map();

const generatePrompt = async (channel, userMessage) => {
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
            content: channel.topic,
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
module.exports = { deleteMessage }

client.on('messageCreate', async message => {
    // Ignore messages from bot
    if (message.author.bot) return;
  
    // Send user message and channel to OpenAI
    const { channel, content } = message;
    try {
      const prompt = await generatePrompt(channel, content);
      sendMessage(channel, "Stretching my synapses...");
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

// use discord.js slash command to clear all channel messages
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    // TODO: If bot doesn't have view channel permission, return;
    // console.log("Interaction: ", interaction);
    // const botPermissions = interaction.channel.permissionsFor(client.user);
    // console.log("Bot Permissions: ", botPermissions.has(PermissionsBitField.Flags.ViewChannel));
    // if (!botPermissions.has(PermissionsBitField.Flags.ViewChannel)) return;

    console.log(`Received command: ${interaction.commandName}`); // Add this line for logging

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        // await interaction.reply({ content: "Executing command...", ephemeral: true, fetchReply: true });
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        return;
        // await interaction.editReply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

client.login(DISCORD_BOT_TOKEN);