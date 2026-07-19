import { CreateWebWorkerMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

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
let currentWorker = null;

const isMobile =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );

// Fix for WindowSizeConfigurationError in WebLLM
prebuiltAppConfig.model_list.forEach((model) => {
  if (!model.overrides) {
    model.overrides = {};
  }
  if (model.overrides.context_window_size !== undefined) {
    model.overrides.sliding_window_size = -1;
  }
  // Prevent WebGPU "Buffer unmapped" OOM errors on mobile
  if (isMobile) {
    model.overrides.context_window_size = 1024;
    model.overrides.prefill_chunk_size = 128;
  }
});

// Populate model select dynamically
modelSelect.innerHTML = '';
prebuiltAppConfig.model_list.forEach((model) => {
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
const defaultModel = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
if (prebuiltAppConfig.model_list.some((m) => m.model_id === defaultModel)) {
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
      engine = null;
    }
    if (currentWorker) {
      currentWorker.terminate();
      currentWorker = null;
    }

    const initProgressCallback = (initProgress) => {
      progressFill.style.width = `${Math.round(initProgress.progress * 100)}%`;
      progressText.textContent = initProgress.text;
    };

    currentWorker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });

    engine = await CreateWebWorkerMLCEngine(currentWorker, selectedModel, {
      initProgressCallback,
      appConfig: prebuiltAppConfig,
    });

    // Setup complete, hide overlay and show app
    setupOverlay.style.display = 'none';
    appContainer.style.display = 'flex';
  } catch (error) {
    console.error('Error loading model:', error);
    const errText =
      error && error.message
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error) || 'Unknown error';
    let errorMessage = 'Error loading model. See console.';
    if (errText.includes('Buffer was unmapped before mapping was resolved')) {
      errorMessage =
        'Error: WebGPU memory limit exceeded. If you are still running into this issue with a specific large model (e.g. 7B parameter models), you may want to fall back to a smaller model version (like 1.5B or 3B parameters) on mobile, as those have a smaller baseline memory footprint per token.';
    }
    progressText.textContent = errorMessage;
    progressText.style.color = 'var(--danger-color)';
    downloadBtn.disabled = false;
    modelSelect.disabled = false;
  }
});

// Web Speech API fallback
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

let recognition;
let isListening = false;
let isGenerating = false;
let finalTranscript = '';
let currentAiSession = null;

// Application states: 'idle', 'listening', 'thinking', 'speaking'
function setAppState(state) {
  appContainer.setAttribute('data-state', state);
  stopBtn.style.display = 'none'; // hide by default in most states

  switch (state) {
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
  if (isGenerating) {
    console.warn('AI is currently processing a request. Ignoring new input.');
    return;
  }
  isGenerating = true;
  setAppState('thinking');
  const sessionId = Date.now();
  currentAiSession = sessionId;

  try {
    if (!engine) {
      throw new Error(
        'AI Engine not initialized. Please refresh and download a model.',
      );
    }

    const messages = [
      {
        role: 'system',
        content:
          'You are a helpful AI voice assistant. Summarize your thoughts and give a very concise, easily comprehensible, and human-like response suitable for spoken audio. Do not output verbose lists or complex formatting.',
      },
      { role: 'user', content: userInput },
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

    const errText =
      error && error.message
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error) || 'Unknown error';
    let errorMessage = 'Error: ' + errText;
    if (errText.includes('Buffer was unmapped before mapping was resolved')) {
      errorMessage +=
        '\n\nAdvisory: If you are still running into this issue with a specific large model (e.g. 7B parameter models), you may want to fall back to a smaller model version (like 1.5B or 3B parameters) on mobile, as those have a smaller baseline memory footprint per token.';
    }
    aiResponseBox.textContent = errorMessage;
    setAppState('idle');
  } finally {
    isGenerating = false;
  }
}

// Speech Synthesis
function getFriendlyVoice() {
  const voices = synth.getVoices();
  const preferredVoices = [
    'Microsoft Aria Online (Natural)',
    'Microsoft Guy Online (Natural)',
    'Microsoft Jenny Online (Natural)',
    'Google US English',
    'Google UK English Female',
    'Google UK English Male',
    'Samantha',
    'Daniel',
    'Karen',
  ];

  for (let pref of preferredVoices) {
    const voice = voices.find((v) => v.name.includes(pref));
    if (voice) return voice;
  }

  return voices.find((v) => v.lang.startsWith('en')) || voices[0];
}

function speakResponse(text) {
  if (!synth) {
    console.warn('Speech synthesis not available.');
    setAppState('idle');
    return;
  }

  setAppState('speaking');

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getFriendlyVoice();
  if (voice) {
    utterance.voice = voice;
  }
  // Adjust pitch slightly if a premium voice isn't found
  if (
    !voice ||
    (!voice.name.includes('Natural') && !voice.name.includes('Google'))
  ) {
    utterance.pitch = 1.1;
  }

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
