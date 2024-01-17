const { SlashCommandBuilder } = require('@discordjs/builders');

// Define the stop command
module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stops the current response stream.'),
    async execute(interaction) {
        // Check if there's an active stream to stop
        if (interaction.client.activeStreamController) {
            // Abort the stream
            interaction.client.activeStreamController.abort();
            // Clear the reference to the controller
            interaction.client.activeStreamController = null;

            // Send a confirmation message
            await interaction.reply({ content: 'Response stream has been stopped.', ephemeral: true });
        } else {
            // Inform the user that there is no active stream
            await interaction.reply({ content: 'There is no active response stream to stop.', ephemeral: true });
        }
    }
};