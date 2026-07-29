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

> Note: This project uses `package-lock.json` as its single source of truth for dependency versions. Do not commit `pnpm-lock.yaml` or `yarn.lock` — only `package-lock.json` is tracked.

## Getting Started

Follow these steps to get your StudyBuddy AI application running locally.

### 1. Set Up Your Environment Variables

The application uses the NVIDIA NIM API for its generative AI features and Clerk for sign-in. You will need keys for both.

1. **NVIDIA NIM API key:** Visit the [NVIDIA build catalog](https://build.nvidia.com/) and generate an API key for the `nvidia/llama-3.3-nemotron-super-49b-v1` model (or any other chat-completion model listed at `https://integrate.api.nvidia.com/v1/models`).
2. **Clerk application:** Create an application at [clerk.com](https://dashboard.clerk.com). From the API keys page, copy the **Publishable Key** (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) and the **Secret Key** (`CLERK_SECRET_KEY`).
3. **Create an Environment File:** In the root directory of the project, create a new file named `.env` and add the keys:

   ```
   NVIDIA_NIM_API_KEY=your_nim_api_key_here
   NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1
   NVIDIA_NIM_MODEL=nvidia/llama-3.3-nemotron-super-49b-v1

   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key_here
   CLERK_SECRET_KEY=your_clerk_secret_key_here
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/signin
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

   DATABASE_URL=postgresql://user:password@ep-your-pooler-region.aws.neon.tech/studybuddy?sslmode=require
   # Optional: direct (unpooled) connection for migrations
   # DATABASE_URL_DIRECT=postgresql://user:password@ep-your-direct-region.aws.neon.tech/studybuddy?sslmode=require
   ```

   Replace the placeholder values with the actual keys you obtained. Auth (users / sessions) is hosted by Clerk; the Neon (Postgres) database only stores app-owned data (uploaded documents, test progress, rate-limit buckets). Create a free project at [neon.tech](https://neon.tech) and copy the pooled connection string into `DATABASE_URL`.

### 2. Apply Database Migrations

After setting `DATABASE_URL` (and optionally `DATABASE_URL_DIRECT`), create the schema tables in Neon:

```bash
npm run migrate
```

This runs `src/scripts/migrate.ts`, which executes the idempotent `SCHEMA_DDL` from `src/lib/db.ts` (safe to run repeatedly — all statements use `CREATE TABLE / INDEX IF NOT EXISTS`).

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
