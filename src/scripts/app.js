// DOM Elements
const appContainer = document.getElementById('app-container');
const micBtn = document.getElementById('mic-btn');
const statusText = document.getElementById('status-text');
const transcriptBox = document.getElementById('transcript');
const aiResponseBox = document.getElementById('ai-response');
const aiLabel = document.getElementById('ai-label');

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
  
  switch(state) {
    case 'idle':
      statusText.textContent = 'Tap to start speaking';
      break;
    case 'listening':
      statusText.textContent = 'Listening...';
      transcriptBox.textContent = '';
      aiResponseBox.textContent = '';
      aiLabel.style.display = 'none';
      break;
    case 'thinking':
      statusText.textContent = 'Thinking...';
      break;
    case 'speaking':
      statusText.textContent = 'Speaking...';
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

// Chrome Prompt API AI Processing
async function handleAIProcessing(userInput) {
  setAppState('thinking');
  
  try {
    let responseText = '';
    
    // Check if any known AI API exists early
    if (!window.ai || (!window.ai.languageModel && !window.ai.assistant && !window.ai.createTextSession)) {
      responseText = "Chrome Built-in AI is not available or the Prompt API is missing.\n\nTo fix this:\n1. Open Chrome Canary or Dev channel.\n2. Navigate to chrome://flags.\n3. Enable '#prompt-api-for-gemini-nano'.\n4. Enable '#optimization-guide-on-device-model'.\n5. Relaunch your browser.";
      console.error('Prompt API not found. Please enable the necessary flags.');
      
      aiLabel.style.display = 'block';
      aiResponseBox.textContent = responseText;
      speakResponse(responseText);
      return;
    }

    let session;
    // Handle the evolving API: window.ai.languageModel vs window.ai.assistant vs window.ai.createTextSession
    if (window.ai.languageModel) {
      // Latest API
      const capabilities = await window.ai.languageModel.capabilities();
      if (capabilities.available === 'no') {
        throw new Error('AI Language Model is not available on this device.');
      }
      session = await window.ai.languageModel.create();
      responseText = await session.prompt(userInput);
    } 
    else if (window.ai.assistant) {
      // Fallback 1
      session = await window.ai.assistant.create();
      responseText = await session.prompt(userInput);
    }
    else if (window.ai.createTextSession) {
      // Fallback 2
      session = await window.ai.createTextSession();
      responseText = await session.prompt(userInput);
    }
    
    // Show AI Response
    aiLabel.style.display = 'block';
    aiResponseBox.textContent = responseText;
    
    // Speak response
    speakResponse(responseText);
    
    // Cleanup session if possible
    if (session && typeof session.destroy === 'function') {
      session.destroy();
    }
    
  } catch (error) {
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
    if (synth.speaking) {
      synth.cancel();
    }
    recognition.start();
  }
});
