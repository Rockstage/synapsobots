const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, EmbedBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('WARNING: Clears all threads and messages in the channel up to 14 days old, except pinned.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageThreads),
    // permissions: ['MANAGE_MESSAGES'],
    async execute(interaction) {
        const { channel } = interaction;
        // if(!interaction.memberPermissions.has(PermissionsBitField.Flags.UseApplicationCommands)) return;
        await interaction.reply({ content: "Clearing messages...", ephemeral: true, fetchReply: true });
        // Bulk delete method - doesn't clear messages/threads older than 14 days
        // Delete all threads in the current channel
        try {
            const fetchedThreads = await channel.threads.fetchActive(); // This should only fetch threads in 'channel'
            fetchedThreads.threads.forEach(async (thread) => {
                if (thread.parentId === channel.id) { // Check if the thread's parent channel ID matches the current channel ID
                    await thread.delete();
                    // console.log(`Deleted thread: ${thread.name}`);
                }
            });
        } catch (error) {
            console.error('An error occurred while deleting threads:', error);
        }
        // Delete all messages
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesToDelete = messages.filter(message => !message.pinned);
            await channel.bulkDelete(messagesToDelete);
            await interaction.editReply({ content: `Cleared ${messagesToDelete.size} messages`, ephemeral: true });
        } catch (error) {
            if (error.code === 50013 || error.code === 50001) { // Permission Error
                interaction.editReply({ content: "I don't have the permission to clear messages.", ephemeral: true });
                return;
            } else {
                console.error("Error while clearing messages:", error); // Update this line for better logging
                interaction.editReply({ content: "Error while clearing messages", ephemeral: true });
            }
        }
    },
};