import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    trimMessages,
} from "@langchain/core/messages";
import { ChatGroq } from "@langchain/groq";
import {
    END,
    MessagesAnnotation,
    START,
    StateGraph,
} from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import wxflows from "@wxflows/sdk/langchain";
import {
    ChatPromptTemplate,
    MessagesPlaceholder,
} from "@langchain/core/prompts";
import SYSTEM_MESSAGE from "@/constants/systemMessage";

// Trim the messages to manage conversation history
const trimmer = trimMessages({
    maxTokens: 10,
    strategy: "last",
    tokenCounter: (msgs) => msgs.length,
    includeSystem: true,
    allowPartial: false,
    startOn: "human",
});

// Connect to wxflows
const toolClient = new wxflows({
    endpoint: process.env.WXFLOWS_ENDPOINT || "",
    apikey: process.env.WXFLOWS_APIKEY,
});

// Retrieve the tools
const tools = await toolClient.lcTools;
const toolNode = new ToolNode(tools);

// Connect to the LLM provider with better tool instructions
const initialiseModel = () => {
    const model = new ChatGroq({
        model: "deepseek-r1-distill-llama-70b",
        apiKey: process.env.GROQ_API_KEY,
        temperature: 0.7,
        streaming: true,
        callbacks: [
            {
                handleLLMStart: async () => {
                    console.log("🤖 Starting LLM call");
                },
                handleLLMEnd: async (output) => {
                    //console.log("🤖 End LLM call", output);
                    const usage = output.llmOutput?.usage;
                    if (usage) {
                        // console.log("📊 Token Usage:", {
                        //   input_tokens: usage.input_tokens,
                        //   output_tokens: usage.output_tokens,
                        //   total_tokens: usage.input_tokens + usage.output_tokens,
                        //   cache_creation_input_tokens:
                        //     usage.cache_creation_input_tokens || 0,
                        //   cache_read_input_tokens: usage.cache_read_input_tokens || 0,
                        // });
                    }
                },
                // handleLLMNewToken: async (token: string) => {
                //   // console.log("🔤 New token:", token);
                // },
            },
        ],
    }).bindTools(tools);

    return model;
};

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof MessagesAnnotation.State) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as AIMessage;

    // If the LLM makes a tool call, then we route to the "tools" node
    if (lastMessage.tool_calls?.length) {
        return "tools";
    }

    // If the last message is a tool message, route back to agent
    if (lastMessage.content && lastMessage._getType() === "tool") {
        return "agent";
    }

    // Otherwise, we stop (reply to the user)
    return END;
}

// Define a new graph
const createWorkflow = () => {
    const model = initialiseModel();

    return new StateGraph(MessagesAnnotation)
        .addNode("agent", async (state) => {
            // Create the system message content
            const systemContent = SYSTEM_MESSAGE;

            // Create the prompt template with system message and messages placeholder
            const promptTemplate = ChatPromptTemplate.fromMessages([
                new SystemMessage(systemContent, {
                    cache_control: { type: "ephemeral" },
                }),
                new MessagesPlaceholder("messages"),
            ]);

            // Trim the messages to manage conversation history
            const trimmedMessages = await trimmer.invoke(state.messages);

            // Format the prompt with the current messages
            const prompt = await promptTemplate.invoke({ messages: trimmedMessages });

            // Get response from the model
            const response = await model.invoke(prompt);

            return { messages: [response] };
        })
        .addNode("tools", toolNode)
        .addEdge(START, "agent")
        .addConditionalEdges("agent", shouldContinue)
        .addEdge("tools", "agent");
};

export async function submitQuestion(messages: BaseMessage[], chatId: string) {
    // Add caching headers to messages
    // console.log("🔒🔒🔒 Messages:", cachedMessages);

    // Create workflow with chatId and onToken callback
    const workflow = createWorkflow();

    // Create a checkpoint to save the state of the conversation
    const checkpointer = new MemorySaver();
    const app = workflow.compile({ checkpointer });

    const stream = await app.streamEvents(
        { messages: messages },
        {
            version: "v2",
            configurable: { thread_id: chatId },
            streamMode: "messages",
            runId: chatId,
        }
    );
    return stream;
}