# StudyBuddy AI

StudyBuddy AI is a Next.js application designed to supercharge your study sessions. Upload your documents (PDF, DOCX, PPTX, or TXT), and let generative AI create interactive tests, answer questions about the content, and provide detailed explanations to help you master the material.

This project is built with Next.js, React, Tailwind CSS, ShadCN UI, and Genkit for its AI capabilities.

## Features

- **Multi-format Document Upload:** Supports PDF, DOCX, PPTX, and plain text files (up to 10MB).
- **AI-Powered Q&A:** Ask questions about your document and get instant, context-aware answers.
- **Customizable Test Generation:** Create tests with various question types (Multiple Choice, True/False, Fill-in-the-Blank, etc.), difficulty levels, and optional timers.
- **Interactive Test Experience:** Get instant feedback on your answers and ask the AI for detailed explanations for incorrect questions.
- **Downloadable Results:** Save a PDF summary of your test performance for offline review.

## Prerequisites

Before you begin, ensure you have the following installed on your local machine:
- [Node.js](https://nodejs.org/en) (v20.x or later is recommended)
- [npm](https://www.npmjs.com/get-npm) (which comes bundled with Node.js)

## Getting Started

Follow these steps to get your StudyBuddy AI application running locally.

### 1. Set Up Your Environment Variables

The application uses the Google Gemini API for its generative AI features. You will need an API key to run the project.

1.  **Get a Gemini API Key:** Visit [Google AI Studio](https://aistudio.google.com/app/apikey) to generate your free API key.
2.  **Create an Environment File:** In the root directory of the project, create a new file named `.env`.
3.  **Add Your API Key:** Open the `.env` file and add your Gemini API key as follows:

    ```
    GEMINI_API_KEY=YOUR_API_KEY_HERE
    ```

    Replace `YOUR_API_KEY_HERE` with the actual key you obtained from Google AI Studio.

### 2. Install Dependencies

Open your terminal, navigate to the project's root directory, and run the following command to install all the necessary packages:

```bash
npm install
```

### 3. Run the Development Server

Once the dependencies are installed, you can start the local development server with this command:

```bash
npm run dev
```

This will start the application in development mode, complete with fast refresh and other modern Next.js features.

### 4. Access the Application

After the server starts, you will see output in your terminal indicating that the application is ready. You can now access it in your web browser at:

[http://localhost:3000](http://localhost:3000)

You are now ready to upload documents and start studying!
