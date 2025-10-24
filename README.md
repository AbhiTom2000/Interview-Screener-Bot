# KPMGInterviewBot

Our bot will serve as the first point of contact for job candidates, automating the initial &#34;Recruiter Phone Screen&#34; phase of the hiring process. Its primary purpose is to efficiently screen a large volume of applicants to identify and prioritize the most qualified candidates for a human recruiter.Core FunctionalityThe bot&#39;s intelligence is powered by a sophisticated combination of AI technologies to handle a predefined set of questions and evaluate responses.Verbal Communication: The bot will communicate with candidates using a human-like voice powered by Text-to-Speech (TTS). It will listen to the candidate&#39;s spoken responses and convert them to text in real-time using Speech-to-Text (STT). This two-way voice interaction simulates a natural conversation.Conversational AI: Using Natural Language Understanding (NLU) from the Azure Language Service, the bot will comprehend the candidate&#39;s answers. It won&#39;t just match keywords; it will understand the intent and context behind what the candidate says.Structured Evaluation: Based on the questions we&#39;ve outlined, the bot will perform several key assessments in the background:Data Extraction: It will pull out specific information like a candidate&#39;s name, years of experience, and salary expectations.Keyword &amp; Concept Matching: It will check if the candidate&#39;s skills and experience match the requirements in the provided job descriptions.Behavioral Assessment: It will analyze how a candidate structures their answers to situational questions, looking for logical flow and clarity.Candidate Qualification: At the end of the session, the bot will generate a summary and a preliminary score based on the evaluation. This output will be used to flag candidates who meet the minimum requirements, allowing the human HR team to focus their time on the most promising applicants.In this phase, the bot will focus solely on the initial screening and will not be handling complex technical interviews.

This bot has been created using [Bot Framework](https://dev.botframework.com), it shows how to create a simple bot that accepts input from the user and echoes it back.

## Prerequisites

- [Node.js](https://nodejs.org) version 10.14.1 or higher

    ```bash
    # determine node version
    node --version
    ```

## To run the bot

- Install modules

    ```bash
    npm install
    ```
- Start the bot

    ```bash
    npm start
    ```

## Testing the bot using Bot Framework Emulator

[Bot Framework Emulator](https://github.com/microsoft/botframework-emulator) is a desktop application that allows bot developers to test and debug their bots on localhost or running remotely through a tunnel.

- Install the Bot Framework Emulator version 4.9.0 or greater from [here](https://github.com/Microsoft/BotFramework-Emulator/releases)

### Connect to the bot using Bot Framework Emulator

- Launch Bot Framework Emulator
- File -> Open Bot
- Enter a Bot URL of `http://localhost:3978/api/messages`

## Deploy the bot to Azure

### Publishing Changes to Azure Bot Service

    ```bash
    # build the TypeScript bot before you publish
    npm run build
    ```

To learn more about deploying a bot to Azure, see [Deploy your bot to Azure](https://aka.ms/azuredeployment) for a complete list of deployment instructions.

## Further reading

- [Bot Framework Documentation](https://docs.botframework.com)
- [Bot Basics](https://docs.microsoft.com/azure/bot-service/bot-builder-basics?view=azure-bot-service-4.0)
- [Dialogs](https://docs.microsoft.com/en-us/azure/bot-service/bot-builder-concept-dialog?view=azure-bot-service-4.0)
- [Gathering Input Using Prompts](https://docs.microsoft.com/en-us/azure/bot-service/bot-builder-prompts?view=azure-bot-service-4.0)
- [Activity processing](https://docs.microsoft.com/en-us/azure/bot-service/bot-builder-concept-activity-processing?view=azure-bot-service-4.0)
- [Azure Bot Service Introduction](https://docs.microsoft.com/azure/bot-service/bot-service-overview-introduction?view=azure-bot-service-4.0)
- [Azure Bot Service Documentation](https://docs.microsoft.com/azure/bot-service/?view=azure-bot-service-4.0)
- [Azure CLI](https://docs.microsoft.com/cli/azure/?view=azure-cli-latest)
- [Azure Portal](https://portal.azure.com)
- [Language Understanding using LUIS](https://docs.microsoft.com/en-us/azure/cognitive-services/luis/)
- [Channels and Bot Connector Service](https://docs.microsoft.com/en-us/azure/bot-service/bot-concepts?view=azure-bot-service-4.0)
- [TypeScript](https://www.typescriptlang.org)
- [Restify](https://www.npmjs.com/package/restify)
- [dotenv](https://www.npmjs.com/package/dotenv)
