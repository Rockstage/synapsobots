const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, EmbedBuilder, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear_older')
        .setDescription('Slowly clears all messages in the channel, including those older than 14 days')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        const { channel } = interaction;
        await interaction.reply({ content: "Clearing messages...", ephemeral: true });

        try {
            let fetched;
            let messageCount = 0;
            do {
                fetched = await channel.messages.fetch({ limit: 100 });
                const messagesToDelete = fetched.filter(message => !message.pinned);

                if (messagesToDelete.size === 0) {
                    break;
                }

                messageCount += messagesToDelete.size;
                for (const message of messagesToDelete.values()) {
                    await message.delete().catch(error => console.error('Error while deleting message:', error));
                }

            } while (fetched.size >= 0);

            await interaction.editReply({ content: `Cleared ${messageCount} messages.`, ephemeral: true });
        } catch (error) {
            console.error("Error while clearing messages:", error);
            interaction.editReply({ content: "Error while clearing messages.", ephemeral: true });
        }
    },
};