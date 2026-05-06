(function () {
    "use strict";

    const STORAGE_KEYS = {
        apiKey: "isooKittyApiKey",
        model: "isooKittyModel",
        endpoint: "isooKittyEndpoint",
        speech: "isooKittySpeech",
        voice: "isooKittyVoice",
        voiceStyle: "isooKittyVoiceStyle"
    };

    const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";
    const WAKE_RESPONSE = "응 이수야 모르는 거 있어?";

    const SYSTEM_PROMPT = [
        "너는 '이수의 수학친구 키티'야. 초등학생 이수가 수학을 스스로 풀도록 돕는 한국어 튜터로 말해.",
        "사용자가 '키티야'라고만 부르면 반드시 정확히 '응 이수야 모르는 거 있어?'라고만 답해.",
        "수학 문제를 받으면 처음부터 최종 답이나 최종 숫자를 말하지 마. 문제를 읽고, 필요한 개념과 다음 한 단계 힌트만 줘.",
        "사진이 있으면 사진 속 문제를 먼저 파악하되, 최종 답 대신 관찰한 식과 풀이를 시작할 힌트를 줘.",
        "이수가 풀이를 제출하면 맞는 부분을 짚고, 틀린 부분은 부드럽게 한 단계만 고쳐 줘.",
        "문장은 짧고 따뜻하게 써. 한 번 답변은 2~5문장으로 유지하고, 마지막에는 이수가 해볼 작은 질문을 하나 남겨."
    ].join("\n");

    const els = {};
    const state = {
        apiKey: "",
        model: "gpt-5.4-mini",
        endpoint: DEFAULT_ENDPOINT,
        speechEnabled: true,
        voiceId: "",
        voiceStyle: "cute",
        voices: [],
        attachments: [],
        turns: [],
        busy: false,
        recognition: null,
        recognizing: false
    };

    function init() {
        cacheElements();
        loadSettings();
        bindEvents();
        setupSpeechSynthesis();
        setupSpeechRecognition();
        renderApiStatus();
        renderEmptyState();
        autosizeInput();
        registerServiceWorker();
    }

    function cacheElements() {
        els.messages = document.getElementById("messages");
        els.form = document.getElementById("chat-form");
        els.input = document.getElementById("user-input");
        els.imageInput = document.getElementById("image-input");
        els.preview = document.getElementById("attachment-preview");
        els.voiceBtn = document.getElementById("voice-btn");
        els.voiceStatus = document.getElementById("voice-status");
        els.speechToggle = document.getElementById("speech-toggle");
        els.sendBtn = document.getElementById("send-btn");
        els.clearChatBtn = document.getElementById("clear-chat-btn");
        els.apiStatus = document.getElementById("api-status");
        els.apiKeyInput = document.getElementById("api-key-input");
        els.saveKeyBtn = document.getElementById("save-key-btn");
        els.clearKeyBtn = document.getElementById("clear-key-btn");
        els.modelSelect = document.getElementById("model-select");
        els.endpointInput = document.getElementById("endpoint-input");
        els.voiceSelect = document.getElementById("voice-select");
        els.voiceStyleSelect = document.getElementById("voice-style-select");
        els.testVoiceBtn = document.getElementById("test-voice-btn");
        els.quickButtons = document.querySelectorAll("[data-prompt]");
    }

    function loadSettings() {
        state.apiKey = localStorage.getItem(STORAGE_KEYS.apiKey) || "";
        state.model = localStorage.getItem(STORAGE_KEYS.model) || state.model;
        state.endpoint = localStorage.getItem(STORAGE_KEYS.endpoint) || DEFAULT_ENDPOINT;
        state.speechEnabled = localStorage.getItem(STORAGE_KEYS.speech) !== "off";
        state.voiceId = localStorage.getItem(STORAGE_KEYS.voice) || "";
        state.voiceStyle = localStorage.getItem(STORAGE_KEYS.voiceStyle) || "cute";

        els.apiKeyInput.value = state.apiKey ? "저장됨" : "";
        els.modelSelect.value = state.model;
        els.endpointInput.value = state.endpoint;
        els.voiceStyleSelect.value = state.voiceStyle;
        els.speechToggle.textContent = state.speechEnabled ? "소리 켜짐" : "소리 꺼짐";
    }

    function bindEvents() {
        els.form.addEventListener("submit", handleSubmit);
        els.input.addEventListener("input", autosizeInput);
        els.input.addEventListener("keydown", handleInputKeydown);
        els.imageInput.addEventListener("change", handleImages);
        els.voiceBtn.addEventListener("click", toggleRecognition);
        els.speechToggle.addEventListener("click", toggleSpeech);
        els.clearChatBtn.addEventListener("click", clearChat);
        els.saveKeyBtn.addEventListener("click", saveApiKey);
        els.clearKeyBtn.addEventListener("click", clearApiKey);
        els.apiKeyInput.addEventListener("focus", handleApiKeyFocus);
        els.modelSelect.addEventListener("change", saveModel);
        els.endpointInput.addEventListener("change", saveEndpoint);
        els.voiceSelect.addEventListener("change", saveVoice);
        els.voiceStyleSelect.addEventListener("change", saveVoiceStyle);
        els.testVoiceBtn.addEventListener("click", testVoice);

        els.quickButtons.forEach((button) => {
            button.addEventListener("click", () => {
                els.input.value = button.dataset.prompt;
                autosizeInput();
                els.form.requestSubmit();
            });
        });
    }

    function handleInputKeydown(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            els.form.requestSubmit();
        }
    }

    async function handleImages(event) {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        for (const file of files.slice(0, 4)) {
            if (!file.type.startsWith("image/")) continue;
            try {
                const image = await imageFileToDataUrl(file);
                state.attachments.push({
                    id: makeId(),
                    name: file.name,
                    dataUrl: image
                });
            } catch (error) {
                addMessage("assistant", "사진을 읽지 못했어. 다른 사진으로 다시 넣어줘.", { error: true });
                console.warn(error);
            }
        }

        event.target.value = "";
        renderAttachmentPreview();
    }

    function imageFileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
            reader.onload = () => resizeImage(reader.result, resolve, reject);
            reader.readAsDataURL(file);
        });
    }

    function resizeImage(dataUrl, resolve, reject) {
        const image = new Image();
        image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
        image.onload = () => {
            const maxSide = 1600;
            const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
            if (scale === 1) {
                resolve(dataUrl);
                return;
            }

            const canvas = document.createElement("canvas");
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.86));
        };
        image.src = dataUrl;
    }

    function renderAttachmentPreview() {
        els.preview.innerHTML = "";
        els.preview.hidden = state.attachments.length === 0;

        state.attachments.forEach((attachment) => {
            const item = document.createElement("div");
            item.className = "preview-item";

            const img = document.createElement("img");
            img.src = attachment.dataUrl;
            img.alt = attachment.name || "첨부 사진";

            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "×";
            remove.setAttribute("aria-label", "사진 삭제");
            remove.addEventListener("click", () => {
                state.attachments = state.attachments.filter((it) => it.id !== attachment.id);
                renderAttachmentPreview();
            });

            item.append(img, remove);
            els.preview.appendChild(item);
        });
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (state.busy) return;

        const text = els.input.value.trim();
        const attachments = [...state.attachments];
        if (!text && !attachments.length) return;

        clearEmptyState();
        addMessage("user", text || "사진 문제를 봐줘", { images: attachments });
        els.input.value = "";
        state.attachments = [];
        renderAttachmentPreview();
        autosizeInput();

        if (isWakeCall(text) && attachments.length === 0) {
            addAssistantTurn(WAKE_RESPONSE);
            return;
        }

        if (!state.apiKey) {
            addMessage("assistant", "GPT API 키를 저장하면 바로 같이 풀 수 있어. 키는 이 브라우저에만 저장할게.", { error: true });
            return;
        }

        setBusy(true);
        const loading = addMessage("assistant", "키티가 문제를 살펴보는 중...", { loading: true });

        try {
            const answer = await askOpenAI(text, attachments);
            loading.remove();
            addAssistantTurn(answer);
        } catch (error) {
            loading.remove();
            addMessage("assistant", friendlyError(error), { error: true });
            console.error(error);
        } finally {
            setBusy(false);
        }
    }

    function isWakeCall(text) {
        return text.replace(/[.!?~。！？\s]/g, "") === "키티야";
    }

    function addAssistantTurn(text) {
        addMessage("assistant", text);
        rememberTurn("assistant", text);
        speak(text);
    }

    async function askOpenAI(text, attachments) {
        const userContent = [];
        userContent.push({
            type: "input_text",
            text: text || "사진 속 수학 문제를 보고, 정답은 말하지 말고 힌트로 도와줘."
        });

        attachments.forEach((attachment) => {
            userContent.push({
                type: "input_image",
                image_url: attachment.dataUrl,
                detail: "auto"
            });
        });

        const input = state.turns.slice(-8).map((turn) => ({
            role: turn.role,
            content: turn.text
        }));

        input.push({
            role: "user",
            content: userContent
        });

        const response = await fetch(state.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.apiKey}`
            },
            body: JSON.stringify({
                model: state.model,
                instructions: SYSTEM_PROMPT,
                input,
                store: false,
                max_output_tokens: 700
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data.error && data.error.message ? data.error.message : `API 오류 ${response.status}`;
            throw new Error(message);
        }

        const answer = extractText(data).trim();
        if (!answer) throw new Error("응답에서 문장을 찾지 못했습니다.");

        rememberTurn("user", text || "사진 문제");
        return answer;
    }

    function extractText(data) {
        if (typeof data.output_text === "string") return data.output_text;
        const parts = [];

        (data.output || []).forEach((item) => {
            (item.content || []).forEach((content) => {
                if (typeof content.text === "string") parts.push(content.text);
                if (content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
            });
        });

        return parts.join("\n");
    }

    function rememberTurn(role, text) {
        if (!text) return;
        state.turns.push({ role, text });
        if (state.turns.length > 12) state.turns = state.turns.slice(-12);
    }

    function addMessage(role, text, options = {}) {
        const message = document.createElement("article");
        message.className = `message ${role}`;

        const avatar = role === "assistant" ? document.createElement("img") : document.createElement("div");
        avatar.className = role === "assistant" ? "avatar" : "avatar user-avatar";
        if (role === "assistant") {
            avatar.src = "cat_head.png";
            avatar.alt = "키티";
        } else {
            avatar.textContent = "이";
            avatar.setAttribute("aria-label", "이수");
        }

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        if (options.loading) bubble.classList.add("loading");
        if (options.error) bubble.classList.add("error");
        bubble.textContent = text;

        if (options.images && options.images.length) {
            const imageWrap = document.createElement("div");
            imageWrap.className = "bubble-images";
            options.images.forEach((attachment) => {
                const img = document.createElement("img");
                img.src = attachment.dataUrl;
                img.alt = attachment.name || "첨부 사진";
                imageWrap.appendChild(img);
            });
            bubble.appendChild(imageWrap);
        }

        message.append(avatar, bubble);
        els.messages.appendChild(message);
        els.messages.scrollTop = els.messages.scrollHeight;
        return message;
    }

    function renderEmptyState() {
        els.messages.innerHTML = [
            '<div class="empty-state" id="empty-state">',
            '<img src="kitty_sticker_happy.png" alt="">',
            "<strong>키티야 하고 불러봐.</strong>",
            "<p>수학 문제를 바로 답하지 않고, 이수가 생각할 수 있게 힌트로 도와줄게.</p>",
            "</div>"
        ].join("");
    }

    function clearEmptyState() {
        const empty = document.getElementById("empty-state");
        if (empty) empty.remove();
    }

    function clearChat() {
        state.turns = [];
        els.messages.innerHTML = "";
        renderEmptyState();
        window.speechSynthesis && window.speechSynthesis.cancel();
    }

    function setBusy(value) {
        state.busy = value;
        els.sendBtn.disabled = value;
        els.input.disabled = value;
    }

    function saveApiKey() {
        const value = els.apiKeyInput.value.trim();
        if (!value || value === "저장됨") return;
        state.apiKey = value;
        localStorage.setItem(STORAGE_KEYS.apiKey, value);
        els.apiKeyInput.value = "저장됨";
        renderApiStatus();
    }

    function clearApiKey() {
        state.apiKey = "";
        localStorage.removeItem(STORAGE_KEYS.apiKey);
        els.apiKeyInput.value = "";
        renderApiStatus();
    }

    function handleApiKeyFocus() {
        if (els.apiKeyInput.value === "저장됨") {
            els.apiKeyInput.value = "";
        }
    }

    function makeId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return String(Date.now() + Math.random());
    }

    function saveModel() {
        state.model = els.modelSelect.value;
        localStorage.setItem(STORAGE_KEYS.model, state.model);
    }

    function saveEndpoint() {
        const value = els.endpointInput.value.trim() || DEFAULT_ENDPOINT;
        state.endpoint = value;
        els.endpointInput.value = value;
        localStorage.setItem(STORAGE_KEYS.endpoint, value);
    }

    function saveVoice() {
        state.voiceId = els.voiceSelect.value;
        localStorage.setItem(STORAGE_KEYS.voice, state.voiceId);
        testVoice();
    }

    function saveVoiceStyle() {
        state.voiceStyle = els.voiceStyleSelect.value;
        localStorage.setItem(STORAGE_KEYS.voiceStyle, state.voiceStyle);
        testVoice();
    }

    function renderApiStatus() {
        els.apiStatus.textContent = state.apiKey ? "API 준비됨" : "API 키 필요";
        els.apiStatus.classList.toggle("ready", Boolean(state.apiKey));
    }

    function friendlyError(error) {
        const message = String(error && error.message ? error.message : error);
        if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
            return "API에 연결하지 못했어. GitHub Pages에서 직접 호출이 막히면, 프록시 서버 주소를 API 주소 칸에 넣어줘.";
        }
        if (/401|api key|authentication|Incorrect API key/i.test(message)) {
            return "API 키를 확인해줘. 키가 틀리거나 권한이 없으면 키티가 답을 받을 수 없어.";
        }
        return `문제를 보다가 멈췄어. ${message}`;
    }

    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            els.voiceBtn.disabled = true;
            els.voiceBtn.textContent = "음성 불가";
            setVoiceStatus("이 브라우저는 음성 인식을 지원하지 않아요. Android Chrome 또는 Microsoft Edge에서 테스트해 주세요.", "error");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = "ko-KR";
        recognition.interimResults = true;
        recognition.continuous = false;
        setVoiceStatus("음성 인식 준비됨. 말하기를 누르고 마이크 권한을 허용해 주세요.");

        recognition.addEventListener("start", () => {
            state.recognizing = true;
            els.voiceBtn.textContent = "듣는 중";
            els.voiceBtn.classList.add("recording");
            setVoiceStatus("듣고 있어요. 예: 키티야", "warning");
        });

        recognition.addEventListener("result", (event) => {
            let finalText = "";
            let interimText = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalText += transcript;
                else interimText += transcript;
            }
            els.input.value = (finalText || interimText).trim();
            autosizeInput();
            if (els.input.value) {
                setVoiceStatus(`인식됨: ${els.input.value}`);
            }
            if (finalText.trim()) {
                window.setTimeout(() => els.form.requestSubmit(), 250);
            }
        });

        recognition.addEventListener("nomatch", () => {
            setVoiceStatus("말을 알아듣지 못했어요. 마이크에 조금 더 가까이 말해 주세요.", "warning");
        });

        recognition.addEventListener("end", () => {
            state.recognizing = false;
            els.voiceBtn.textContent = "말하기";
            els.voiceBtn.classList.remove("recording");
        });

        recognition.addEventListener("error", (event) => {
            state.recognizing = false;
            els.voiceBtn.textContent = "말하기";
            els.voiceBtn.classList.remove("recording");
            setVoiceStatus(speechErrorMessage(event.error), "error");
        });

        state.recognition = recognition;
    }

    function toggleRecognition() {
        if (!state.recognition) return;
        if (state.recognizing) {
            state.recognition.stop();
        } else {
            try {
                state.recognition.start();
            } catch (error) {
                setVoiceStatus("음성 인식을 시작하지 못했어요. 페이지를 새로고침한 뒤 다시 눌러 주세요.", "error");
            }
        }
    }

    function setVoiceStatus(message, tone) {
        if (!els.voiceStatus) return;
        els.voiceStatus.textContent = message;
        els.voiceStatus.classList.toggle("warning", tone === "warning");
        els.voiceStatus.classList.toggle("error", tone === "error");
    }

    function speechErrorMessage(code) {
        const messages = {
            "not-allowed": "마이크 권한이 차단되었어요. 브라우저 주소창의 권한 설정에서 마이크를 허용해 주세요.",
            "service-not-allowed": "브라우저가 음성 인식 서비스를 차단했어요. Chrome/Edge에서 다시 테스트해 주세요.",
            "audio-capture": "마이크를 찾지 못했어요. 태블릿의 마이크 권한과 입력 장치를 확인해 주세요.",
            "no-speech": "말소리가 감지되지 않았어요. 말하기를 다시 누르고 또박또박 말해 주세요.",
            "network": "음성 인식 서비스에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.",
            "language-not-supported": "한국어 음성 인식이 이 브라우저에서 지원되지 않을 수 있어요.",
            "language-unavailable": "한국어 음성 인식 언어팩을 사용할 수 없어요."
        };
        return messages[code] || `음성 인식 오류가 났어요: ${code || "알 수 없음"}`;
    }

    function toggleSpeech() {
        state.speechEnabled = !state.speechEnabled;
        localStorage.setItem(STORAGE_KEYS.speech, state.speechEnabled ? "on" : "off");
        els.speechToggle.textContent = state.speechEnabled ? "소리 켜짐" : "소리 꺼짐";
        if (!state.speechEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
        if (state.speechEnabled) testVoice();
    }

    function speak(text) {
        if (!state.speechEnabled || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = getSelectedVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = "ko-KR";
        applyVoiceStyle(utterance);
        utterance.onstart = () => setVoiceStatus("키티가 읽어주는 중이에요.");
        utterance.onerror = () => setVoiceStatus("목소리를 재생하지 못했어요. 테스트 버튼을 한 번 눌러 다시 확인해 주세요.", "error");
        window.speechSynthesis.speak(utterance);
        if (typeof window.speechSynthesis.resume === "function") {
            window.setTimeout(() => window.speechSynthesis.resume(), 120);
        }
    }

    function setupSpeechSynthesis() {
        if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
            els.speechToggle.disabled = true;
            els.voiceSelect.disabled = true;
            els.voiceStyleSelect.disabled = true;
            els.testVoiceBtn.disabled = true;
            els.speechToggle.textContent = "소리 불가";
            return;
        }

        const loadVoices = () => {
            state.voices = window.speechSynthesis.getVoices();
            renderVoiceOptions();
        };

        loadVoices();
        if (typeof window.speechSynthesis.addEventListener === "function") {
            window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
        } else {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }

    function renderVoiceOptions() {
        const voices = [...state.voices].sort((a, b) => {
            const aKo = a.lang && a.lang.toLowerCase().startsWith("ko") ? 0 : 1;
            const bKo = b.lang && b.lang.toLowerCase().startsWith("ko") ? 0 : 1;
            return aKo - bKo || a.name.localeCompare(b.name);
        });

        els.voiceSelect.innerHTML = "";

        const auto = document.createElement("option");
        auto.value = "";
        auto.textContent = "자동 선택";
        els.voiceSelect.appendChild(auto);

        if (!voices.length) {
            auto.textContent = "자동 선택 - 목소리 불러오는 중";
            return;
        }

        voices.forEach((voice) => {
            const option = document.createElement("option");
            option.value = voiceId(voice);
            option.textContent = `${voice.name} (${voice.lang})`;
            els.voiceSelect.appendChild(option);
        });

        els.voiceSelect.value = voices.some((voice) => voiceId(voice) === state.voiceId) ? state.voiceId : "";
    }

    function getSelectedVoice() {
        if (!state.voices.length) state.voices = window.speechSynthesis.getVoices();
        if (state.voiceId) {
            const selected = state.voices.find((voice) => voiceId(voice) === state.voiceId);
            if (selected) return selected;
        }
        return state.voices.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith("ko"))
            || state.voices.find((voice) => voice.default)
            || state.voices[0]
            || null;
    }

    function voiceId(voice) {
        return `${voice.name}::${voice.lang}`;
    }

    function applyVoiceStyle(utterance) {
        const styles = {
            cute: { pitch: 1.35, rate: 1.02 },
            soft: { pitch: 1.08, rate: 0.94 },
            slow: { pitch: 1.0, rate: 0.82 }
        };
        const style = styles[state.voiceStyle] || styles.cute;
        utterance.pitch = style.pitch;
        utterance.rate = style.rate;
    }

    function testVoice() {
        if (!state.speechEnabled) {
            state.speechEnabled = true;
            localStorage.setItem(STORAGE_KEYS.speech, "on");
            els.speechToggle.textContent = "소리 켜짐";
        }
        speak("안녕 이수야. 키티 목소리 테스트야.");
    }

    function autosizeInput() {
        els.input.style.height = "auto";
        els.input.style.height = `${Math.min(els.input.scrollHeight, 150)}px`;
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("sw_isoo.js").catch((error) => {
                console.warn("Service worker registration failed.", error);
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
