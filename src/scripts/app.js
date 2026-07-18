import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

// Setup DOM Elements
const setupOverlay = document.getElementById('setup-overlay');
const modelSelect = document.getElementById('model-select');
const downloadBtn = document.getElementById('download-btn');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

// App DOM Elements
const appContainer = document.getElementById('app-container');
const micBtn = document.getElementById('mic-btn');
const statusText = document.getElementById('status-text');
const transcriptBox = document.getElementById('transcript');
const aiResponseBox = document.getElementById('ai-response');
const aiLabel = document.getElementById('ai-label');

const switchModelBtn = document.getElementById('switch-model-btn');
const stopBtn = document.getElementById('stop-btn');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');

let engine = null;

// Fix for WindowSizeConfigurationError in WebLLM
prebuiltAppConfig.model_list.forEach(model => {
  if (!model.overrides) {
    model.overrides = {};
  }
  if (model.overrides.context_window_size !== undefined) {
    model.overrides.sliding_window_size = -1;
  }
});

// Populate model select dynamically
modelSelect.innerHTML = '';
prebuiltAppConfig.model_list.forEach(model => {
  const option = document.createElement('option');
  option.value = model.model_id;
  
  let displayName = model.model_id;
  if (model.vram_required_MB) {
    const vramGB = (model.vram_required_MB / 1024).toFixed(1);
    displayName += ` (~${vramGB}GB)`;
  }
  
  option.textContent = displayName;
  modelSelect.appendChild(option);
});

// Set default model
const defaultModel = "Llama-3.2-1B-Instruct-q4f32_1-MLC";
if (prebuiltAppConfig.model_list.some(m => m.model_id === defaultModel)) {
  modelSelect.value = defaultModel;
}

// Switch Model Logic
switchModelBtn.addEventListener('click', () => {
  appContainer.style.display = 'none';
  setupOverlay.style.display = 'flex';
  
  // Reset UI for download
  progressContainer.style.display = 'none';
  progressFill.style.width = '0%';
  progressText.textContent = 'Initializing...';
  downloadBtn.disabled = false;
  modelSelect.disabled = false;
});

// Setup Logic
downloadBtn.addEventListener('click', async () => {
  const selectedModel = modelSelect.value;
  downloadBtn.disabled = true;
  modelSelect.disabled = true;
  progressContainer.style.display = 'block';

  try {
    if (engine) {
      engine.unload();
    }

    const initProgressCallback = (initProgress) => {
      progressFill.style.width = `${Math.round(initProgress.progress * 100)}%`;
      progressText.textContent = initProgress.text;
    };

    engine = await CreateMLCEngine(selectedModel, { 
      initProgressCallback,
      appConfig: prebuiltAppConfig
    });
    
    // Setup complete, hide overlay and show app
    setupOverlay.style.display = 'none';
    appContainer.style.display = 'flex';
  } catch (error) {
    console.error("Error loading model:", error);
    progressText.textContent = "Error loading model. See console.";
    progressText.style.color = 'var(--danger-color)';
    downloadBtn.disabled = false;
    modelSelect.disabled = false;
  }
});

// Web Speech API fallback
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

let recognition;
let isListening = false;
let finalTranscript = '';
let currentAiSession = null;

// Application states: 'idle', 'listening', 'thinking', 'speaking'
function setAppState(state) {
  appContainer.setAttribute('data-state', state);
  stopBtn.style.display = 'none'; // hide by default in most states
  
  switch(state) {
    case 'idle':
      statusText.textContent = 'Tap to start speaking or type a message';
      break;
    case 'listening':
      statusText.textContent = 'Listening...';
      transcriptBox.textContent = '';
      aiResponseBox.textContent = '';
      aiLabel.style.display = 'none';
      break;
    case 'thinking':
      statusText.textContent = 'Thinking...';
      stopBtn.style.display = 'flex';
      break;
    case 'speaking':
      statusText.textContent = 'Speaking...';
      stopBtn.style.display = 'flex';
      break;
  }
}

// Initialize Speech Recognition
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false; // Stop when user stops speaking
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    finalTranscript = '';
    setAppState('listening');
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    transcriptBox.textContent = finalTranscript + interimTranscript;
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      alert('Microphone access is required.');
    }
    setAppState('idle');
    isListening = false;
  };

  recognition.onend = () => {
    isListening = false;
    
    if (finalTranscript.trim().length > 0) {
      // User finished speaking, now send to AI
      handleAIProcessing(finalTranscript);
    } else {
      setAppState('idle');
    }
  };
} else {
  alert('Web Speech API is not supported in this browser. Try Chrome.');
}

// WebLLM Processing
async function handleAIProcessing(userInput) {
  setAppState('thinking');
  const sessionId = Date.now();
  currentAiSession = sessionId;
  
  try {
    if (!engine) {
      throw new Error("AI Engine not initialized. Please refresh and download a model.");
    }

    const messages = [
      { role: "system", content: "You are a helpful AI voice assistant. Summarize your thoughts and give a very concise, easily comprehensible, and human-like response suitable for spoken audio. Do not output verbose lists or complex formatting." },
      { role: "user", content: userInput }
    ];

    const reply = await engine.chat.completions.create({ messages });
    
    if (currentAiSession !== sessionId) return;

    const responseText = reply.choices[0].message.content;
    
    // Show AI Response
    aiLabel.style.display = 'block';
    aiResponseBox.textContent = responseText;
    
    // Speak response
    speakResponse(responseText);
    
  } catch (error) {
    if (currentAiSession !== sessionId) return;
    console.error('AI Processing Error:', error);
    aiLabel.style.display = 'block';
    aiResponseBox.textContent = 'Error: ' + error.message;
    setAppState('idle');
  }
}

// Speech Synthesis
function speakResponse(text) {
  if (!synth) {
    console.warn('Speech synthesis not available.');
    setAppState('idle');
    return;
  }
  
  setAppState('speaking');
  
  const utterance = new SpeechSynthesisUtterance(text);
  
  utterance.onend = () => {
    setAppState('idle');
  };
  
  utterance.onerror = (e) => {
    console.error('Speech synthesis error:', e);
    setAppState('idle');
  };
  
  synth.speak(utterance);
}

// Event Listeners
micBtn.addEventListener('click', () => {
  if (isListening) {
    recognition.stop();
  } else {
    // Stop any ongoing speech synthesis before starting new recognition
    if (synth && synth.speaking) {
      synth.cancel();
    }
    recognition.start();
  }
});

stopBtn.addEventListener('click', () => {
  currentAiSession = null;
  if (engine && typeof engine.interruptGenerate === 'function') {
    engine.interruptGenerate();
  }
  if (synth && synth.speaking) {
    synth.cancel();
  }
  setAppState('idle');
});

function handleTextSubmit() {
  const text = textInput.value.trim();
  if (text.length > 0) {
    textInput.value = '';
    // Stop listening if mic is active
    if (isListening) {
      recognition.stop();
    }
    // Cancel any ongoing speech
    if (synth && synth.speaking) {
      synth.cancel();
    }
    transcriptBox.textContent = text;
    handleAIProcessing(text);
  }
}

sendBtn.addEventListener('click', handleTextSubmit);
textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleTextSubmit();
  }
});
