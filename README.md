# EduAssist – AI-Powered Educational & Institutional Assistant

**An intelligent RAG-based platform that helps students get accurate, context-aware answers from institutional PDF documents and general educational knowledge.**

EduAssist is an AI-powered educational assistant designed for schools, colleges, and universities. It uses Retrieval-Augmented Generation (RAG) to retrieve relevant information from uploaded institutional documents and generate reliable answers with source citations.

It also supports general educational assistance, helping students understand academic concepts, explore subjects, and clarify doubts through conversational AI.

---

## Overview

Students frequently struggle to find accurate information about attendance requirements, examination regulations, academic policies, admissions, scholarships, and institutional guidelines.

EduAssist addresses this problem through a centralized AI-powered platform where students can ask questions in natural language and receive relevant answers.

The application maintains a clear distinction between institution-specific information retrieved from uploaded PDFs and general educational explanations.

## Key Features

### 1. AI-Powered Institutional Assistant
- Ask questions about school and college policies using natural language.
- Retrieve relevant information from uploaded institutional PDFs.
- Generate context-aware answers based on retrieved document content.
- Display source citations with document names and page numbers.
- Inspect retrieved source excerpts when needed.

### 2. General Educational Assistance
- Supports academic questions across multiple educational levels.
- Explains concepts in simple, student-friendly language.
- Provides assistance with mathematics, science, programming, and engineering concepts.
- Generates contextual explanations and examples.

### 3. Multi-Institution PDF Management
- Create separate collections for different schools and colleges.
- Upload institutional handbooks, academic regulations, syllabi, and circulars.
- Maintain isolated document collections.
- Validate PDF files and prevent duplicate uploads.
- Track document upload and indexing status.

### 4. Retrieval-Augmented Generation (RAG)
- Extract text from uploaded PDF documents.
- Divide extracted content into manageable chunks.
- Generate embeddings for semantic retrieval.
- Store document vectors for similarity-based search.
- Retrieve relevant chunks to provide context-grounded answers.
- Generate responses with supporting source references.

### 5. Knowledge Boundary Management

EduAssist supports three knowledge modes:

| Mode | Description |
|---|---|
| Separated Dual Mode | Separates institutional answers from general educational explanations. |
| Institutional PDFs Only | Answers strictly using uploaded institutional documents. |
| General Subjects Only | Provides general educational assistance without presenting it as official institutional policy. |

### 6. Persistent Document Storage
- Store uploaded PDF files separately from document metadata.
- Maintain document and collection information across server restarts.
- Preserve indexed document information.
- Support document deletion and collection-specific isolation.

### 7. Responsive User Interface
- Clean and professional interface.
- Responsive layouts for desktop, tablet, and mobile.
- Organized institutional collections.
- Conversational question-and-answer interface.
- Clear loading, error, and response states.

---

## Application Architecture

EduAssist follows a frontend-backend architecture with a RAG-based knowledge retrieval pipeline.

```text
                 STUDENT
                    |
                    v
             EDUASSIST FRONTEND
               React + TypeScript
                    |
                    v
               BACKEND API
                  Express
                    |
          +---------+---------+
          |                   |
          v                   v
    DOCUMENT MODULE       CHAT MODULE
          |                   |
          v                   v
     PDF UPLOAD           USER QUERY
          |                   |
          v                   v
     PDF EXTRACTION      QUERY PROCESSING
          |                   |
          v                   v
     TEXT CHUNKING       QUERY EMBEDDING
          |                   |
          v                   v
     EMBEDDING MODEL     VECTOR RETRIEVAL
          |                   |
          v                   v
     VECTOR STORAGE <--- SIMILARITY SEARCH
                              |
                              v
                       RETRIEVED CONTEXT
                              |
                              v
                         GEMINI API
                              |
                              v
                      GENERATED ANSWER
                              |
                              v
                     SOURCE CITATIONS
                              |
                              v
                           STUDENT
```

---

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript |
| Build Tool | Vite |
| Styling | CSS / Tailwind CSS |
| Backend | Node.js, Express |
| AI Integration | Google Gemini API |
| RAG Architecture | Retrieval-Augmented Generation |
| Document Processing | PDF text extraction |
| Vector Search | Embeddings and vector similarity retrieval |
| Storage | Local filesystem and persistent metadata |
| Development Environment | Visual Studio Code |

---

## Project Structure

```text
EduAssist/
│
├── src/
│   ├── components/
│   │   ├── Sidebar
│   │   ├── Header
│   │   ├── MessageItem
│   │   ├── MessageComposer
│   │   └── CollectionsManager
│   │
│   ├── services/
│   │   └── apiClient.ts
│   │
│   └── App.tsx
│
├── server/
│   ├── config/
│   ├── routes/
│   ├── storage/
│   └── app.ts
│
├── shared/
│   └── types/
│
├── data/
│   ├── uploads/
│   └── metadata/
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

*Note: This is a simplified architectural overview. The actual directory structure may contain additional files and modules.*

---

## Getting Started

### Prerequisites

Install the following before running EduAssist:

- Node.js (compatible with the project's dependencies)
- npm
- Visual Studio Code
- Google Gemini API key

### 1. Clone the Repository

```bash
git clone https://github.com/Sharath-Soma/EduAssist
```

Navigate into the project:

```bash
cd EduAssist
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file using `.env.example` as the reference.

Configure the required environment variables, including your Gemini API key and storage settings.

```env
GEMINI_API_KEY=your_gemini_api_key
STORAGE_PROVIDER=local-fs
```

Use the exact variable names and values supported by the current application configuration.

**Important:** Never commit your `.env` file or expose API keys in your GitHub repository.

### 4. Start the Application

Run the development command configured in `package.json`.

```bash
npm run dev
```

If the frontend and backend use separate development commands, start both services in separate terminals.

Open the local development URL displayed in your terminal.

---

## How to Use EduAssist

1. Open the EduAssist application.
2. Select an academic track or create a new institutional collection.
3. Enter the school or college details.
4. Upload the relevant institutional PDF documents.
5. Wait for document ingestion and indexing to complete.
6. Select the appropriate knowledge mode.
7. Enter a question in the workspace.
8. Receive an AI-generated answer supported by relevant institutional sources or general educational knowledge, depending on the selected mode.

---

## Example Queries

**Institutional Questions**
- What are the minimum attendance requirements?
- What is the examination eligibility criteria?
- What are the rules for applying for leave?
- What are the scholarship eligibility requirements?
- What is the procedure for examination registration?

**General Educational Questions**
- Explain object-oriented programming with examples.
- What is the difference between supervised and unsupervised learning?
- Explain the working of a binary search algorithm.
- What is cloud computing?
- Explain the fundamentals of machine learning.

---

## Reliability and Knowledge Boundaries

EduAssist is designed to distinguish between verified institutional information and general AI-generated educational explanations.

- Institutional answers should be grounded in retrieved document content.
- Institutional responses should include supporting source citations.
- Missing information should not be presented as an established institutional rule.
- General educational explanations should never be misrepresented as official institutional policies.
- Retrieval quality and source availability influence answer accuracy.

---

## Future Enhancements

- Student authentication and personalized dashboards.
- Conversation history and saved queries.
- Support for additional document formats.
- Advanced hybrid search combining keyword and semantic retrieval.
- Improved document processing for scanned PDFs using OCR.
- Multilingual educational assistance.
- Voice-based interaction for accessibility.
- Administrative dashboard for managing institutional knowledge.
- Cloud deployment and scalable document storage.

---

## Project Goals

EduAssist aims to make institutional information more accessible, simplify student doubt clarification, reduce the effort required to search lengthy academic documents, and provide a unified educational assistance platform.

**One platform. Two knowledge sources. Smarter learning.**

---

## License

This project is currently developed as an independent educational technology project.

Add an appropriate open-source license before distributing or accepting external contributions.
