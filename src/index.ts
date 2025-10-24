// Load environment variables from .env file (if running locally)
import * as path from 'path';
import { config } from 'dotenv';

const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

import express from 'express';
import { 
    CloudAdapter, 
    ConfigurationServiceClientCredentialFactory,
    createBotFrameworkAuthenticationFromConfiguration,
    TurnContext,
    // BotFrameworkAdapter is not strictly needed but kept for completeness
} from 'botbuilder';

// Import the bot
import { MyBot } from './bot';

// --- Server Setup (Express) ---
const app = express();
// IMPORTANT: Body parsers must come first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || process.env.port || 3978;

// --- Adapter Setup (CloudAdapter) ---

const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
    MicrosoftAppId: process.env.MicrosoftAppId,
    MicrosoftAppPassword: process.env.MicrosoftAppPassword,
    MicrosoftAppType: process.env.MicrosoftAppType,
    MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
});

const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);

const adapter = new CloudAdapter(botFrameworkAuthentication);

// Error handler
const onTurnErrorHandler = async (context: TurnContext, error: Error) => {
    console.error(`\n [onTurnError] unhandled error: ${error}`);
    // IMPORTANT: Log stack trace to console for debugging in Azure
    console.error(error.stack); 

    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error}`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    await context.sendActivity('I apologize, but I encountered an unexpected error. Please try again.');
};

adapter.onTurnError = onTurnErrorHandler;

// Create the bot instance
const myBot = new MyBot();

// --- Express Routes ---

// Handle OPTIONS requests explicitly, often required for CORS/proxies
app.options('/api/messages', (req, res) => {
    res.header('Allow', 'POST, OPTIONS').sendStatus(200);
});

// Add health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'KPMG Interview Bot',
        version: '1.0.0'
    });
});

// Main bot endpoint
app.post('/api/messages', async (req, res) => {
    try {
        // The core adapter processing logic
        await adapter.process(req, res, (context) => myBot.run(context));
    } catch (error) {
        console.error('Error processing bot message:', error);
        // Ensure error status code is returned
        res.status(500).json({ error: 'Internal server error during bot processing' });
    }
});

// Root endpoint with bot information
app.get('/', (req, res) => {
    res.json({
        name: 'KPMG Global Services Interview Bot',
        description: 'Automated initial screening bot for job candidates',
        version: '1.0.0',
        endpoints: {
            messages: '/api/messages',
            health: '/api/health'
        },
        status: 'running'
    });
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`\n🤖 KPMG Interview Bot listening on port ${port}`);
    console.log(`📍 Bot endpoint: http://localhost:${port}/api/messages`);
    console.log('\nDeployment ready to receive messages.\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down KPMG Interview Bot...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down KMPG Interview Bot...');
    process.exit(0);
});
