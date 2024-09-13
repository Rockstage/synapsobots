const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
dotenv.config();

const commands = [];
// Grab all the command files and folders from the commands directory
const commandsPath = path.join(__dirname, 'commands');
const commandFilesAndFolders = fs.readdirSync(commandsPath);

for (const item of commandFilesAndFolders) {
	const itemPath = path.join(commandsPath, item);
	const stats = fs.lstatSync(itemPath);

	if (stats.isDirectory()) {
		// If the item is a directory, process its files
		const commandFiles = fs.readdirSync(itemPath).filter(file => file.endsWith('.js'));
		for (const file of commandFiles) {
			const filePath = path.join(itemPath, file);
			const command = require(filePath);
			if ('data' in command && 'execute' in command) {
				commands.push(command.data.toJSON());
			} else {
				console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
			}
		}
	} else if (stats.isFile() && item.endsWith('.js')) {
		// If the item is a file, process it directly
		const command = require(itemPath);
		if ('data' in command && 'execute' in command) {
			commands.push(command.data.toJSON());
		} else {
			console.log(`[WARNING] The command at ${itemPath} is missing a required "data" or "execute" property.`);
		}
	}
}

// Determine the environment and set the appropriate token and application ID
const isProduction = process.env.NODE_ENV === 'production';
const token = isProduction ? process.env.DISCORD_BOT_TOKEN : process.env.DISCORD_DEV_BOT_TOKEN;
const applicationId = isProduction ? process.env.DISCORD_APPLICATION_ID : process.env.DISCORD_DEV_APPLICATION_ID;
const serverId = isProduction ? process.env.DISCORD_SERVER_ID : process.env.DISCORD_SERVER_ID;  // Use the same server ID for both environments

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// Determine the route based on the environment
const route = isProduction
	? Routes.applicationCommands(applicationId)
	: Routes.applicationGuildCommands(applicationId, serverId);

// Deploy your commands
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		// The put method is used to fully refresh all commands in the target (global or guild) with the current set
		const data = await rest.put(route, { body: commands });

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error(error);
	}
})();