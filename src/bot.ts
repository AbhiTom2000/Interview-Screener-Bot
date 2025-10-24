import { ActivityHandler, TurnContext } from 'botbuilder';
// CORRECT: Use official OpenAI SDK (supports Azure OpenAI)
import OpenAI from 'openai';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';

// --- INTERVIEW STATE FOR DYNAMIC FLOW ---
interface InterviewState {
    candidateName?: string;
    currentStage: 'greeting' | 'name_prompt' | 'jd_selection' | 'pre_screen' | 'jd_questions' | 'closing' | 'complete';
    jdFileName?: string;
    jdContent: string;
    availableJDs: string[];
    questionCount: number;
    maxQuestions: number;
    responses: Record<string, any>;
    conversationHistory: { role: "user" | "assistant", content: string }[];
}

export class MyBot extends ActivityHandler {
    // Official OpenAI client (works with Azure OpenAI)
    private readonly openaiClient: OpenAI;
    private readonly blobServiceClient: BlobServiceClient;

    // Configuration Variables
    private readonly openaiDeploymentName: string;
    private readonly jdContainerName: string;
    private readonly storageAccountName: string;
    private readonly storageAccountKey: string;
    private readonly speechServiceRegion: string;
    private readonly speechServiceKey: string;

    private readonly interviewStates: Map<string, InterviewState> = new Map();

    private readonly fixedFlow = {
        greeting: {
            question: "Hello! Welcome to the KPMG Global Services initial interview. I am your AI interviewer.",
            nextStage: 'jd_selection' as const
        },
        jd_selection: {
            nextStage: 'name_prompt' as const
        },
        name_prompt: {
            question: "Thank you for confirming the role. To begin, please tell me your full name.",
            nextStage: 'pre_screen' as const
        },
        pre_screen: {
            question: "It's a pleasure to meet you, {name}. I have confirmed the Job Description for the role you applied for. Before we dive into technical and value-based questions, please summarize your educational background and professional experience, focusing on how you meet the job's basic requirements.",
            nextStage: 'jd_questions' as const
        },
        closing: {
            question: "Thank you, {name}, for taking the time to complete this interview. Your responses have been recorded and will be reviewed by our hiring team. You can expect to hear back from us within 3-5 business days. Have a great day!",
            nextStage: 'complete' as const
        }
    };
    
    constructor() {
        super();
        
        // Validate required environment variables
        this.validateEnvironment();
        
        // --- INITIALIZE OPENAI CLIENT FOR AZURE (FIXED TS ERROR) ---
        // The previous attempt failed compilation because the `azure` property is not 
        // recognized in your version of the OpenAI SDK types.
        // We revert to the pattern that relies on setting the full Azure endpoint 
        // URL path including the deployment name, and using an explicit api-key header.
        this.openaiClient = new OpenAI({
            apiKey: process.env.AzureOpenAIKey,
            // FIX: Set the baseURL to include the deployment name directly to bypass the 
            // TS error and still work with Azure's API structure.
            baseURL: `${process.env.AzureOpenAIEndpoint}/openai/deployments/${process.env.AzureOpenAIDeploymentName}`,
            defaultQuery: { 'api-version': '2024-08-01-preview' },
            // Pass the API key explicitly as a header, required for Azure authentication
            defaultHeaders: { 'api-key': process.env.AzureOpenAIKey }
            
        } as any); // Use 'as any' to suppress the TS error temporarily
        // Note: For newer SDK versions, the `azure: {...}` property is correct, 
        // but for your current dependency structure, this is the solution.
        this.openaiDeploymentName = process.env.AzureOpenAIDeploymentName!;

        // Speech Service Config
        this.speechServiceKey = process.env.SpeechServiceKey!;
        this.speechServiceRegion = process.env.SpeechServiceRegion!;

        // Azure Storage Config
        this.jdContainerName = process.env.JOB_DESCRIPTION_CONTAINER!;
        this.storageAccountName = process.env.STORAGE_ACCOUNT_NAME!;
        this.storageAccountKey = process.env.STORAGE_ACCOUNT_KEY!;

        const storageCredential = new StorageSharedKeyCredential(
            this.storageAccountName,
            this.storageAccountKey
        );
        this.blobServiceClient = new BlobServiceClient(
            `https://${this.storageAccountName}.blob.core.windows.net`,
            storageCredential
        );

        // Welcome message handler
        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            if (membersAdded && membersAdded.length > 0) {
                for (const member of membersAdded) {
                    if (member.id !== context.activity.recipient.id) {
                        await this.sendWelcomeMessage(context);
                    }
                }
            }
            await next();
        });

        // Message handler
        this.onMessage(async (context, next) => {
            await this.processUserMessage(context);
            await next();
        });
    }

    private validateEnvironment(): void {
        const required = [
            'AzureOpenAIEndpoint',
            'AzureOpenAIKey',
            'AzureOpenAIDeploymentName',
            'SpeechServiceKey',
            'SpeechServiceRegion',
            'JOB_DESCRIPTION_CONTAINER',
            'STORAGE_ACCOUNT_NAME',
            'STORAGE_ACCOUNT_KEY',
            'AVAILABLE_JDS'
        ];

        const missing = required.filter(key => !process.env[key]);
        if (missing.length > 0) {
            // NOTE: This throws an error which crashes the process if variables are missing.
            // On Azure, this means the application fails to start (HTTP 503/500).
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
    }

    private getUserState(userId: string): InterviewState {
        if (!this.interviewStates.has(userId)) {
            const availableJDs = process.env.AVAILABLE_JDS?.split(',').map(j => j.trim()) || [];
            
            this.interviewStates.set(userId, {
                currentStage: 'greeting',
                availableJDs: availableJDs,
                jdContent: '',
                questionCount: 0,
                maxQuestions: 5,
                responses: {},
                conversationHistory: []
            });
        }
        return this.interviewStates.get(userId)!;
    }

    private async fetchJobDescription(fileName: string): Promise<string> {
        try {
            const containerClient = this.blobServiceClient.getContainerClient(this.jdContainerName);
            const blobClient = containerClient.getBlobClient(fileName);
            
            if (!(await blobClient.exists())) {
                throw new Error(`Job Description file not found: ${fileName}`);
            }

            const downloadResponse = await blobClient.download();
            const downloaded = await new Promise<string>((resolve, reject) => {
                const chunks: Buffer[] = [];
                downloadResponse.readableStreamBody?.on('data', (chunk) => {
                    chunks.push(Buffer.from(chunk));
                });
                downloadResponse.readableStreamBody?.on('end', () => {
                    resolve(Buffer.concat(chunks).toString('utf8'));
                });
                downloadResponse.readableStreamBody?.on('error', reject);
            });
            
            return downloaded;
        } catch (error) {
            console.error(`Error fetching JD (${fileName}):`, error);
            return `JD Fetch Failed for ${fileName}. Default Role: Senior Consultant. Key Skills: Leadership, Project Management, Azure.`;
        }
    }

    private async sendWelcomeMessage(context: TurnContext): Promise<void> {
        const state = this.getUserState(context.activity.from.id);
        const welcomeMessage = this.fixedFlow.greeting.question;
        
        await context.sendActivity({
            type: 'message',
            text: welcomeMessage,
            speak: this.generateSsml(welcomeMessage)
        });

        state.conversationHistory.push({ role: "assistant", content: welcomeMessage });
        state.currentStage = 'jd_selection';
        await this.askForJDSelection(context, state);
    }
    
    private async askForJDSelection(context: TurnContext, state: InterviewState): Promise<void> {
        const jdList = state.availableJDs.map((name, index) => 
            `${index + 1}. ${name.replace('.txt', '')}`
        ).join(', ');
        
        const questionText = `We offer interviews for the following roles: ${jdList}. Please say the number or the name of the role you are here for.`;
        
        await context.sendActivity({
            type: 'message',
            text: questionText,
            speak: this.generateSsml(questionText)
        });
        
        state.conversationHistory.push({ role: "assistant", content: questionText });
    }

    private async processUserMessage(context: TurnContext): Promise<void> {
        const userText = context.activity.text?.trim();
        const userId = context.activity.from.id;
        const state = this.getUserState(userId);

        if (!userText) {
            await context.sendActivity({
                type: 'message',
                text: "I didn't receive any speech. Could you please speak up?",
                speak: this.generateSsml("I didn't receive any speech. Could you please speak up?")
            });
            return;
        }
        
        state.conversationHistory.push({ role: "user", content: userText });
        
        try {
            if (state.currentStage === 'jd_selection') {
                await this.handleJDSelection(context, userText, state);
            } else if (state.currentStage === 'name_prompt') {
                await this.handleNameExtraction(context, userText, state);
            } else if (state.currentStage === 'pre_screen') {
                state.responses[`pre_screen_raw_response`] = userText;
                await this.handleGPTResponseAnalysis(context, userText, state);
                state.currentStage = this.fixedFlow.pre_screen.nextStage;
                await this.askNextDynamicQuestion(context, state);
            } else if (state.currentStage === 'jd_questions') {
                state.responses[`jd_q${state.questionCount + 1}_raw_response`] = userText;
                await this.handleGPTResponseAnalysis(context, userText, state);

                if (state.questionCount < state.maxQuestions) {
                    await this.askNextDynamicQuestion(context, state);
                } else {
                    state.currentStage = 'closing';
                    await this.sendNextQuestion(context, state);
                }
            } else if (state.currentStage === 'closing') {
                // The closing message is sent as the next step in sendNextQuestion, 
                // but this stage handles potential post-closing user messages.
                await this.completeInterview(context, state);
            } else if (state.currentStage === 'complete') {
                 // Ignore messages after interview completion
                await context.sendActivity({
                    type: 'message',
                    text: "Your interview has been completed. Thank you!",
                    speak: this.generateSsml("Your interview has been completed. Thank you!")
                });
            } else {
                 // Fallback
                 await context.sendActivity({
                    type: 'message',
                    text: "I seem to be in an unknown state. Let's restart the interview. Please refresh if this persists.",
                    speak: this.generateSsml("I seem to be in an unknown state. Let's restart the interview. Please refresh if this persists.")
                });
            }
        } catch (error) {
            console.error("Error processing message:", error);
            await this.sendErrorMessage(context);
        }
    }
    
    private async handleJDSelection(context: TurnContext, userText: string, state: InterviewState): Promise<void> {
        const jdListString = state.availableJDs.join(', ');
        // NOTE: Using this.openaiDeploymentName instead of an empty string
        const systemPrompt = `You are a file selection expert. Available files: ${jdListString}. Return ONLY the exact filename with extension that the user selected. If unclear, return 'N/A'.`;
        
        try {
            const completion = await this.openaiClient.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userText }
                ],
                // BEST PRACTICE: Explicitly use the deployment name
                model: this.openaiDeploymentName,
                temperature: 0.0,
                max_tokens: 50
            });

            const chosenFileName = completion.choices[0].message?.content?.trim();
            
            if (chosenFileName && chosenFileName !== 'N/A' && state.availableJDs.includes(chosenFileName)) {
                state.jdFileName = chosenFileName;
                state.jdContent = await this.fetchJobDescription(chosenFileName);
                state.currentStage = this.fixedFlow.jd_selection.nextStage;
                
                const questionText = this.fixedFlow.name_prompt.question;
                await context.sendActivity({
                    type: 'message',
                    text: questionText,
                    speak: this.generateSsml(questionText)
                });
                state.conversationHistory.push({ role: "assistant", content: questionText });
            } else {
                const message = `I couldn't identify that selection. Please select a number between 1 and ${state.availableJDs.length}.`;
                await context.sendActivity({
                    type: 'message',
                    text: message,
                    speak: this.generateSsml(message)
                });
                state.conversationHistory.push({ role: "assistant", content: message });
            }
        } catch (error) {
            console.error("Error in JD selection:", error);
            await this.sendErrorMessage(context);
        }
    }

    private generateSsml(text: string): string {
        const sanitizedText = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
            <prosody rate='medium' pitch='medium'>
                ${sanitizedText}
            </prosody>
        </speak>`;
    }

    private async handleNameExtraction(context: TurnContext, userText: string, state: InterviewState): Promise<void> {
        try {
            const systemPrompt = "Extract the full name from the text. Return ONLY the name. If no name found, return 'N/A'.";
    
            const completion = await this.openaiClient.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userText }
                ],
                // BEST PRACTICE: Explicitly use the deployment name
                model: this.openaiDeploymentName,
                temperature: 0.0,
                max_tokens: 50
            });
    
            const name = completion.choices[0].message?.content?.trim();
            const cleanName = name?.replace(/['"]/g, '');
            const normalizedName = cleanName?.toUpperCase() !== 'N/A' ? cleanName : null;
    
            if (normalizedName) {
                state.candidateName = normalizedName;
                state.currentStage = this.fixedFlow.name_prompt.nextStage;
                await this.sendNextQuestion(context, state);
            } else {
                await this.sendNameClarification(context, state);
            }
        } catch (error) {
            console.error("Error extracting name:", error);
            await this.sendNameClarification(context, state);
        }
    }

    private async generateDynamicQuestion(state: InterviewState): Promise<string> {
        const candidateName = state.candidateName || 'Candidate';
        const currentQNum = state.questionCount + 1;
        
        const systemPrompt = `You are the KPMG AI Interviewer conducting question Q${currentQNum}.
JD: ${state.jdContent}

Based on conversation history and JD, generate ONE relevant, challenging technical or value-based question. Must be under 30 words. Return ONLY the question.
Candidate Name: ${candidateName}.`;
        
        const messages: any[] = [
            { role: "system", content: systemPrompt },
            // Keep the last few turns for context
            ...state.conversationHistory.slice(-6)
        ];

        try {
            const completion = await this.openaiClient.chat.completions.create({
                messages: messages,
                // BEST PRACTICE: Explicitly use the deployment name
                model: this.openaiDeploymentName,
                temperature: 0.7,
                max_tokens: 100
            });

            const questionText = completion.choices[0].message?.content?.trim();
            
            if (!questionText || questionText.length < 20) {
                return `For question ${currentQNum}, describe a complex challenge you solved that aligns with the role.`;
            }
            return questionText;
        } catch (error) {
            console.error("Error generating question:", error);
            return `For question ${currentQNum}, tell me about a relevant project from your experience.`;
        }
    }

    private async handleGPTResponseAnalysis(context: TurnContext, userText: string, state: InterviewState): Promise<void> {
        const stage = state.currentStage === 'jd_questions' ? `jd_q${state.questionCount + 1}` : state.currentStage;
        const candidateName = state.candidateName || 'Candidate';
        
        try {
            const gptSystemPrompt = `You are a KPMG HR assessment agent. Candidate: ${candidateName}.
JD: ${state.jdContent.substring(0, 500)}...

Analyze the response and return ONLY a JSON object:
{
  "ClarityScore": 1-5,
  "RelevanceScore": 1-5,
  "Summary": "brief 1-sentence assessment",
  "ExtractedEntities": [{"entity": "type", "text": "value"}]
}

Extract entities like: Audit_Standard, SAP_Module, Years_Experience, Certification, Tech_Stack`;
            
            const gptResponse = await this.openaiClient.chat.completions.create({
                messages: [
                    { role: "system", content: gptSystemPrompt },
                    { role: "user", content: userText }
                ],
                // BEST PRACTICE: Explicitly use the deployment name
                model: this.openaiDeploymentName,
                temperature: 0.2,
                response_format: { type: "json_object" },
                max_tokens: 400
            });

            const gptAnalysis = JSON.parse(gptResponse.choices[0].message?.content || '{}');
            state.responses[`${stage}_gpt_summary`] = gptAnalysis.Summary || 'Summary pending.';
            state.responses[`${stage}_clarity_score`] = gptAnalysis.ClarityScore || 'N/A';
            state.responses[`${stage}_relevance_score`] = gptAnalysis.RelevanceScore || 'N/A';
            state.responses[`${stage}_entities`] = gptAnalysis.ExtractedEntities || [];

        } catch (error) {
            console.error(`Analysis failed for ${stage}:`, error);
            state.responses[`${stage}_gpt_summary`] = 'Analysis failed.';
            state.responses[`${stage}_entities`] = [];
        }
        
        if (state.currentStage === 'jd_questions') {
            state.questionCount++;
        }
    }
    
    private async askNextDynamicQuestion(context: TurnContext, state: InterviewState): Promise<void> {
        const questionText = await this.generateDynamicQuestion(state);
        
        await context.sendActivity({
            type: 'message',
            text: questionText,
            speak: this.generateSsml(questionText)
        });
        
        state.conversationHistory.push({ role: "assistant", content: questionText });
    }
    
    private async sendNextQuestion(context: TurnContext, state: InterviewState): Promise<void> {
        let questionText = '';
        if (state.currentStage === 'pre_screen') {
            questionText = this.fixedFlow.pre_screen.question.replace('{name}', state.candidateName || 'there');
        } else if (state.currentStage === 'closing') {
            questionText = this.fixedFlow.closing.question.replace('{name}', state.candidateName || 'there');
        }

        await context.sendActivity({
            type: 'message',
            text: questionText,
            speak: this.generateSsml(questionText)
        });
        
        state.conversationHistory.push({ role: "assistant", content: questionText });
    }

    private async sendNameClarification(context: TurnContext, state: InterviewState): Promise<void> {
        const message = "I apologize, I didn't catch your name. Could you state it clearly? For example: 'My name is John Smith'";
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
            <prosody rate='medium'>
                I apologize, I didn't quite catch your full name.
                <break time='300ms'/>
                Could you please state it clearly?
            </prosody>
        </speak>`;

        await context.sendActivity({
            type: 'message',
            text: message,
            speak: ssml
        });
        // FIX: Add clarification message to history for context
        state.conversationHistory.push({ role: "assistant", content: message });
    }

    private async completeInterview(context: TurnContext, state: InterviewState): Promise<void> {
        state.currentStage = 'complete';

        let totalClarityScore = 0;
        let totalRelevanceScore = 0;
        let validScores = 0;
        let detailedReport = '';

        const stages = ['pre_screen'];
        for (let i = 1; i <= state.maxQuestions; i++) {
            stages.push(`jd_q${i}`);
        }

        for (const stage of stages) {
            const clarity = parseInt(state.responses[`${stage}_clarity_score`]);
            const relevance = parseInt(state.responses[`${stage}_relevance_score`]);
            
            if (!isNaN(clarity) && !isNaN(relevance)) {
                totalClarityScore += clarity;
                totalRelevanceScore += relevance;
                validScores++;
            }

            const gptSummary = state.responses[`${stage}_gpt_summary`] || 'No data.';
            const extractedEntities = state.responses[`${stage}_entities`];
            const entityList = Array.isArray(extractedEntities) 
                ? extractedEntities.map((e: any) => `${e.text} (${e.entity})`).join(', ') 
                : 'No structured data.';

            if (stage === 'pre_screen') {
                detailedReport += `
--- Initial Screening ---
Summary: ${gptSummary}
Clarity/Relevance: ${clarity || 'N/A'}/${relevance || 'N/A'}
Entities: ${entityList}
`;
            } else {
                detailedReport += `
--- Question ${stage.slice(-1)} ---
Summary: ${gptSummary}
Clarity/Relevance: ${clarity || 'N/A'}/${relevance || 'N/A'}
Entities: ${entityList}
`;
            }
        }
        
        const avgClarity = validScores > 0 ? (totalClarityScore / validScores).toFixed(1) : 'N/A';
        const avgRelevance = validScores > 0 ? (totalRelevanceScore / validScores).toFixed(1) : 'N/A';
        const overallScore = validScores > 0 ? ((totalClarityScore + totalRelevanceScore) / (validScores * 2) / 5 * 100).toFixed(0) : 'N/A';

        const summaryText = `
Interview Summary for ${state.candidateName || 'Candidate'}:

--- Final Assessment ---
Role: ${state.jdFileName?.replace('.txt', '') || 'N/A'}
Questions Answered: ${state.questionCount}

Average Clarity: **${avgClarity}/5**
Average Relevance: **${avgRelevance}/5**
Qualification Score: **${overallScore}%**

${detailedReport}

Your responses will be reviewed by the KPMG hiring team. Thank you!
        `.trim();

        const finalSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
            <prosody rate='medium'>
                Interview completed, ${state.candidateName}. 
                Your score is ${overallScore} percent.
                Thank you for your time!
            </prosody>
        </speak>`;

        await context.sendActivity({
            type: 'message',
            text: summaryText,
            speak: finalSsml
        });
        
        // Final message added to conversation history
        state.conversationHistory.push({ role: "assistant", content: summaryText });
        // After completion, clear state to allow a new interview if the user stays
        this.interviewStates.delete(context.activity.from.id);
    }

    private async sendErrorMessage(context: TurnContext): Promise<void> {
        const errorMessage = "I'm experiencing technical difficulties. Could you please repeat your last response?";
        const errorSsml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
            <prosody rate='medium'>
                I'm experiencing some technical difficulties.
                <break time='300ms'/>
                Could you please repeat?
            </prosody>
        </speak>`;

        await context.sendActivity({
            type: 'message',
            text: errorMessage,
            speak: errorSsml
        });
    }
}
