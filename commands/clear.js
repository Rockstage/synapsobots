const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, EmbedBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clears all messages in the channel, except pinned')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),
    // permissions: ['MANAGE_MESSAGES'],
    async execute(interaction) {
        const { channel } = interaction;
        // if(!interaction.memberPermissions.has(PermissionsBitField.Flags.UseApplicationCommands)) return;
        await interaction.reply({ content: "Clearing messages...", ephemeral: true, fetchReply: true });

        // Delete one by one
        // try {
        //     let fetched;
        //     let messageCount = 0;
        //     do {
        //         fetched = await channel.messages.fetch({ limit: 100 });
        //         const messagesToDelete = fetched.filter(message => !message.pinned);

        //         // Break the loop if there are no more messages to delete
        //         if (messagesToDelete.size === 0) {
        //             break;
        //         }

        //         messageCount += messagesToDelete.size;
        //         for (const message of messagesToDelete.values()) {
        //             await message.delete().catch(error => console.error('Error while deleting message:', error));
        //         }
        //     } while (fetched.size >= 0);
        //     await interaction.editReply({ content: `Cleared ${messageCount} messages`, ephemeral: true });
        // } catch (error) {
        //     console.log("Error while clearing messages:", error);
        //     interaction.editReply({ content: "Error while clearing messages", ephemeral: true });
        // }
        
        // Bulk delete method - doesn't clear messages older than 14 days
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
                console.log("Error while clearing messages:", error); // Update this line for better logging
                interaction.editReply({ content: "Error while clearing messages", ephemeral: true });
            }
        }
    },
};