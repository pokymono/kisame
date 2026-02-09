# Kisame — Context & System Description

## What Kisame Is

**Kisame** is a **standalone, AI-assisted network forensics analysis tool**.

It operates on **PCAP files** and helps analysts **understand what happened on the network** by:

- reconstructing sessions
- building timelines
- highlighting notable patterns using deterministic rules
- providing **evidence-anchored explanations** through a Cursor-style chat interface

Kisame does **not** capture traffic, detect attacks automatically, or make security decisions.
It assists **human reasoning** over forensic evidence.

---

## Core Philosophy

Kisame is built around three principles:

1. **Evidence First**
   Every explanation must trace back to concrete packet data.

2. **AI Assists, Never Decides**
   The AI explains and summarizes. It does not label traffic as malicious or benign.

3. **Structure Before Language**
   Raw packets → structured data → sessions → timelines → explanation.

---

## What Problem Kisame Solves

### Existing Reality

Tools like Wireshark and tshark are excellent at **displaying packets**, but they:

- overwhelm users with low-level detail
- require significant expertise to interpret
- do not help reconstruct a coherent narrative
- do not assist with reasoning or reporting

### Kisame’s Role

Kisame bridges the gap between:

> “Here are millions of packets”
> and
> “Here is what likely happened, backed by evidence”

It converts raw network traffic into **structured understanding**.

---

## What Kisame Is NOT

This is important for correct interpretation by LLMs and users.

Kisame is **not**:

- an IDS or IPS
- a malware detector
- a live network monitor
- an automated incident response tool
- a replacement for Wireshark

Kisame **complements** traditional tools by focusing on **post-capture forensic analysis and explanation**.

---

## High-Level Architecture

Kisame consists of **three strictly separated layers**:

```
PCAP File
   ↓
Python Forensic Engine
   ↓ (JSON summaries)
Bun + AI SDK (Explanation Layer)
   ↓
Electron UI (Cursor-style workspace)
```

Each layer has a **single responsibility**.

---

## 1. Forensic Engine (Python)

### Purpose

- Parse PCAP files
- Reconstruct network sessions
- Build timelines
- Apply deterministic triage rules
- Produce structured, machine-readable analysis artifacts

### Key Characteristics

- Uses **tshark** internally (Wireshark’s decoding engine)
- Works entirely offline on PCAPs
- Produces reproducible results
- Contains no AI logic

### Outputs

The engine outputs structured JSON containing:

- packet events
- session objects
- timeline events
- rule flags
- evidence references (packet numbers, timestamps)

This layer defines **ground truth** for Kisame.

---

## 2. Explanation Layer (Bun + AI SDK)

### Purpose

- Transform structured forensic summaries into human-readable explanations
- Support conversational analysis through a constrained chat interface

### What the AI Receives

The AI **never sees raw packets**.

It only receives:

- session summaries
- timelines
- rule annotations
- counts and metadata
- explicit evidence identifiers

### What the AI Produces

- Explanations of observed behavior
- Clarifications in response to user questions
- Narrative summaries for reports

### Hard Constraints

The AI:

- must reference evidence identifiers
- must not invent events
- must not label traffic as malicious
- must not speculate beyond available data

This makes Kisame **AI-assisted, not AI-driven**.

---

## 3. User Interface (Electron)

### Purpose

Provide a calm, analyst-centric workspace inspired by **Cursor’s editor + chat layout**.

The UI is **read-only** with respect to evidence.

---

## Kisame UI — Complete Description

### Overall Layout

```
┌────────────────────────────────────────────────────────────┐
│ Top Bar                                                     │
├──────────────┬──────────────────────┬─────────────────────┤
│ Session List │ Timeline / Details   │ Explanation + Chat   │
├──────────────┴──────────────────────┴─────────────────────┤
│ Evidence / Packet References                               │
└────────────────────────────────────────────────────────────┘
```

All analysis happens in this single workspace.

---

### Top Bar

- Open PCAP
- Display PCAP metadata
- Analysis progress
- Export options (JSON / Markdown)

No capture controls. No live traffic.

---

### Session List (Left Panel)

- Lists reconstructed network sessions
- Each session shows:
  - endpoints
  - protocol chain
  - duration
  - packet count
  - subtle rule indicators

This replaces packet-by-packet navigation.

---

### Timeline & Details (Center Panel)

Displays **facts only**.

- Chronological events:
  - DNS resolution
  - connection establishment
  - requests / responses
  - data bursts
  - termination

No AI text appears here.

This panel is the **forensic backbone** of the UI.

---

### Explanation + Chat (Right Panel — Cursor-Style)

This panel behaves like Cursor’s chat sidebar.

#### Explanation Context (Top)

- Automatically generated explanation for the selected session
- Neutral, descriptive tone
- Explicit references to:
  - session ID
  - timestamps
  - packet ranges

This represents Kisame’s current “understanding”.

---

#### Chat Interface (Bottom)

Allows the user to **ask questions about the evidence**.

Examples:

- “Explain this session in simpler terms”
- “Why was this behavior highlighted?”
- “What happened immediately before this connection?”
- “Summarize this activity for a report”

The chat:

- is context-aware (session, timeline selection)
- answers only using analyzed data
- always references evidence

This mirrors how Cursor explains code using file context.

---

### Evidence Panel (Bottom)

Shows:

- packet numbers
- timestamps
- key decoded fields

Everything the AI references appears here.

This panel exists to **maintain forensic defensibility**.

---

## Typical User Workflow

1. User opens a PCAP file
2. Kisame parses and analyzes the capture
3. Sessions appear in the left panel
4. User selects a session
5. Timeline and explanation update
6. User asks questions in the chat
7. Explanations reference concrete packet evidence

This workflow emphasizes **exploration and reasoning**, not alerts.

---

## How Kisame Should Be Described (Canonical Summary)

Use this description consistently:

> **Kisame is an AI-assisted network forensics tool that helps analysts reconstruct, explore, and explain network activity from PCAP files using session reconstruction, timelines, and evidence-anchored conversational analysis.**

---

## How Other LLMs Should Interpret Kisame

When another LLM interacts with Kisame:

- Treat Kisame as an **analysis assistant**, not an authority
- Never assume malicious intent unless explicitly stated by the user
- Always ground responses in provided structured data
- Prefer explanation over judgment
- Prefer clarity over confidence

---

## Final Mental Model

If someone asks, “What does Kisame feel like?”

The correct answer is:

> “Kisame feels like using Cursor, but instead of explaining code, it helps you reason about network traffic — calmly, transparently, and with evidence.”
