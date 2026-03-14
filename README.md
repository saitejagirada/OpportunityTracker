# OppTracker: AI-Powered Opportunity Capture & Management

OppTracker is an enterprise-grade ecosystem designed to solve the challenge of fragmented student opportunities. By leveraging Large Language Models (LLMs) and cross-platform integration, OppTracker transforms cluttered job listings into structured, actionable data.

## Business Value Proposition

In the modern job market, students are overwhelmed by information across Telegram groups, WhatsApp chats, and various job boards. OppTracker provides:

*   **Centralized Intelligence**: Converts unstructured messages from chat platforms into a structured database automatically.
*   **Proactive Engagement**: Delivers automated reminders via Email and WhatsApp to ensure deadlines are never missed.
*   **Cross-Platform Accessibility**: Interaction via Telegram and WhatsApp bots allows users to save and query opportunities in real-time without leaving their primary communication tools.
*   **Efficiency at Scale**: AI-driven extraction eliminates manual data entry, allowing for a high volume of opportunity tracking with zero overhead.

## Ecosystem Architecture

The platform is built on a robust, scalable stack designed for high availability and low latency:

*   **Frontend**: A responsive dashboard built with **React 19** and **Vite**, featuring modern styling via **Tailwind CSS** and smooth interactions powered by **Motion**.
*   **AI Intelligence**: Core extraction and intent classification powered by **Groq (Llama 3.1)** and **Google Gemini AI**.
*   **Backend & Storage**: **Supabase** (PostgreSQL) handles real-time data persistence, authentication, and database rules.
*   **Communication Layer**:
    *   **Telegram Bot**: Built with `node-telegram-bot-api` for seamless opportunity forwarding and querying.
    *   **WhatsApp Bot**: Powered by **Twilio**, providing a premium mobile interface for opportunity management.
    *   **Reminder Service**: A specialized node service utilizing **Nodemailer** and Twilio for automated multi-channel notifications.

## Key Features

1.  **Semantic Opportunity Extraction**: Automatically identifies company, role, location, stipend, and deadlines from forwarded messages.
2.  **Conversational Querying**: Users can ask natural language questions (e.g., "Find software internships in Bangalore") to retrieve filtered results.
3.  **Automated Deadline Tracking**: A background service monitors application deadlines and triggers alerts 12 hours prior to closing.
4.  **Omnichannel Support**: Unified experience across Web, Telegram, and WhatsApp.

## Technical Setup

### Prerequisites

*   Node.js (v18 or higher)
*   Supabase Account & Project
*   Groq API Key
*   Twilio Account (for WhatsApp)
*   SMTP Credentials (for Email reminders)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/opptracker.git
    cd opptracker
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Configuration

1.  **Environment Variables**: The project requires several API keys to function. Create a `.env` file in the root directory based on the `.env.example` provided:
    ```bash
    cp .env.example .env
    ```
    *Note: Ensure you populate all keys (Supabase, Groq, Twilio, and SMTP) for full ecosystem functionality.*

2.  **Run the complete ecosystem:**
    ```bash
    npm start
    ```
    This command utilizes `concurrently` to launch the Vite development server, Telegram bot, WhatsApp bot, and the Reminder service simultaneously.

## Common Troubleshooting

If you encounter issues when deploying to a new machine, check the following:

### 1. `concurrently: command not found`
**Symptoms**: Terminal returns `sh: concurrently: command not found` when running `npm start`.
**Fix**: This usually means `npm install` was skipped or failed. Run:
```bash
npm install
```
The `start` script uses the local version of `concurrently` within `node_modules`.

### 2. `ETELEGRAM: 409 Conflict`
**Symptoms**: "Terminated by other getUpdates request". 
**Fix**: You have multiple instances of the Telegram bot running with the same token. Ensure all previous processes are terminated before restarting.

### 3. Port 3001 Already in Use
**Symptoms**: WhatsApp bot fails to start with "Address already in use".
**Fix**: Find and kill the process using port 3001:
*   **Mac/Linux**: `lsof -i :3001` then `kill -9 <PID>`
*   **Windows**: `netstat -ano | findstr :3001` then `taskkill /F /PID <PID>`

### 4. Database Permission Errors (42501)
**Symptoms**: Bots fail to save opportunities to Supabase.
**Fix**: Check your Supabase Row-Level Security (RLS) settings. Ensure the `SUPABASE_SERVICE_ROLE_KEY` is correctly set in `.env` to bypass RLS for admin actions.

## Deployment

The project is configured for deployment on platforms like rendered (refer to `render.yaml`) or Vercel. Ensure all environment variables are correctly mapped in your production environment.

---
*Developed by StochasticGradients*

