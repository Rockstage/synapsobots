const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, EmbedBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clears all messages in the channel, except pinned')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),
    // permissions: ['MANAGE_MESSAGES'],
    async execute(interaction) {
        console.log("Clearing messages...", PermissionFlagsBits.ViewChannel);
        const { channel } = interaction;
        // if (!interaction.member.permissions.has(PermissionsBitField.MANAGE_MESSAGES)) {
        //     console.log("Permission check failed"); // Add this line for logging
        //     const embed = new MessageEmbed()
        //         .setTitle('Error')
        //         .setDescription('You do not have permission to use this command')
        //         .setColor(0xff0000)
        //         .setTimestamp()
        //         .setFooter('Clear Command');
        //     return interaction.reply({ embeds: [embed], ephemeral: true });
        // }
        if(!interaction.memberPermissions.has(PermissionsBitField.Flags.SendMessages)) return;
        await interaction.reply({ content: "Clearing messages...", ephemeral: true, fetchReply: true });

        try {
            let fetched;
            let messageCount = 0;
            do {
                fetched = await channel.messages.fetch({ limit: 100 });
                const messagesToDelete = fetched.filter(message => !message.pinned);

                // Break the loop if there are no more messages to delete
                if (messagesToDelete.size === 0) {
                    break;
                }

                messageCount += messagesToDelete.size;
                for (const message of messagesToDelete.values()) {
                    await message.delete().catch(error => console.error('Error while deleting message:', error));
                }
            } while (fetched.size >= 0);
            await interaction.editReply({ content: `Cleared ${messageCount} messages`, ephemeral: true });
        } catch (error) {
            console.log("Error while clearing messages:", error);
            interaction.editReply({ content: "Error while clearing messages", ephemeral: true });
        }
        
        // Bulk delete method - doesn't clear messages older than 14 days
        // await interaction.reply({ content: "Clearing messages...", ephemeral: true, fetchReply: true });
        // try {
        //     const messages = await channel.messages.fetch({ limit: 100 });
        //     const messagesToDelete = messages.filter(message => !message.pinned);
        //     console.log("messages to delete:", messagesToDelete);
        //     await channel.bulkDelete(messagesToDelete);
        //     await interaction.editReply({ content: `Cleared ${messagesToDelete.size} messages`, ephemeral: true });
        // } catch (error) {
        //     console.log("Error while clearing messages:", error); // Update this line for better logging
        //     interaction.editReply({ content: "Error while clearing messages", ephemeral: true });
        // }
    },
};