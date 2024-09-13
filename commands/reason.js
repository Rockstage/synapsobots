const { SlashCommandBuilder } = require('@discordjs/builders');
const { createThread } = require('../utils.js');

console.log("Reasoning Command file loaded...");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reason')
        .setDescription('Creates a reasoning thread with gpt-o1 or better'),
    
    async execute(interaction) {
        console.log("Reasoning Command executing...");
        try {
            const message = await interaction.reply({ content: '!Reasoning...', fetchReply: true });

            console.log("Creating Reasoning Thread...");

            let thread = await createThread(message);

            await interaction.editReply(`Thread created: ${thread.name}`);
        } catch (error) {
            console.error('Error creating thread:', error);
            await interaction.editReply('Failed to create thread. Please try again later.');
        }
    },
};

// module.exports = {
//     data: new SlashCommandBuilder()
//         .setName('reason')
//         .setDescription('Get a reasoned response from a different GPT model')
//         .addStringOption(option =>
//             option.setName('prompt')
//                 .setDescription('The prompt to send to the GPT model')
//                 .setRequired(true)),
//     async execute(interaction) {
//         const prompt = interaction.options.getString('prompt');
//         const reasoningModel = process.env.REASONING_MODEL || 'o1-preview';

//         try {
//             console.log(`Received prompt: ${prompt}`);
//             console.log(`Using reasoning model: ${reasoningModel}`);

//             // Call the GPT model with the given prompt
//             await gptStreamingResponse(prompt, interaction, null, reasoningModel);

//             console.log('Response sent successfully');
//         } catch (error) {
//             console.error('Error occurred while processing the command:', error);
//             await interaction.reply({ content: 'There was an error while processing your request.', ephemeral: true });
//         }
//     },
// };

