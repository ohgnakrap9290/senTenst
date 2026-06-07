import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { recognize } from "tesseract.js";
import "./styles.css";

let pdfJsPromise;

function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfJs, worker]) => {
      pdfJs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfJs;
    });
  }
  return pdfJsPromise;
}

const DIFFICULTIES = [
  { level: 1, label: "가볍게", ratio: 0.15 },
  { level: 2, label: "보통", ratio: 0.25 },
  { level: 3, label: "집중", ratio: 0.35 },
  { level: 4, label: "어렵게", ratio: 0.45 },
  { level: 5, label: "도전", ratio: 0.6 },
];

const SAMPLE_TEXT = `Small steps make a big difference.
오늘의 노력이 내일의 실력이 된다.
Learning another language opens a new window.
포기하지 않으면 분명히 성장할 수 있다.`;

function shuffle(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function normalizeText(text) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSentences(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const lines = normalized
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?。！？]+[.!?。！？]?/g) || [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 2);

  return [...new Set(lines)];
}

function tokenize(sentence) {
  return sentence.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|[^\p{L}\p{N}\s]+/gu) || [];
}

function cleanAnswer(token) {
  return token.toLocaleLowerCase().replace(/[^\p{L}\p{N}'’\-]/gu, "");
}

function makeQuestion(sentence, ratio) {
  const tokens = tokenize(sentence);
  const candidates = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => /[\p{L}\p{N}]/u.test(token));
  const blankCount = Math.min(
    Math.max(1, Math.round(candidates.length * ratio)),
    Math.max(1, candidates.length - 1),
  );
  const blanks = new Set(
    shuffle(candidates)
      .slice(0, blankCount)
      .map(({ index }) => index),
  );
  return { sentence, tokens, blanks };
}

function Icon({ name, size = 20 }) {
  const paths = {
    moon: <path d="M20.5 14.2A8 8 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
        <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <circle cx="9" cy="10" r="2" />
        <path d="m4 17 4.5-4 3.5 3 3-2.5 5 4.5" />
      </>
    ),
    pen: <path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20Zm10.5-13.5 3 3" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    back: <path d="m15 18-6-6 6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    refresh: <path d="M20 7v5h-5M4 17v-5h5m9.5-4A8 8 0 0 0 5.3 6M5.5 16A8 8 0 0 0 18.7 18" />,
    spark: <path d="m12 2 1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2Zm7 13 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [screen, setScreen] = useState("setup");
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [difficulty, setDifficulty] = useState(3);
  const [mode, setMode] = useState("write");
  const [ocr, setOcr] = useState({ active: false, progress: 0, current: "" });
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState(new Set());
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState([]);
  const fileInput = useRef(null);

  const sentences = useMemo(() => extractSentences(text), [text]);
  const question = questions[current];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#171815" : "#f4f2ec",
    );
  }, [theme]);

  async function runOcr(selectedFiles) {
    if (!selectedFiles.length) return;
    setOcr({ active: true, progress: 0, current: selectedFiles[0].name });
    const chunks = [];
    try {
      const sources = [];

      for (const file of selectedFiles) {
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const { getDocument } = await loadPdfJs();
          const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            sources.push({ type: "pdf", file, pdf, pageNumber });
          }
        } else {
          sources.push({ type: "image", file });
        }
      }

      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        const label = source.type === "pdf"
          ? `${source.file.name} · ${source.pageNumber}/${source.pdf.numPages}페이지`
          : source.file.name;
        let imageSource = source.file;

        if (source.type === "pdf") {
          const page = await source.pdf.getPage(source.pageNumber);
          const baseViewport = page.getViewport({ scale: 2 });
          const scale = Math.min(1, 2600 / Math.max(baseViewport.width, baseViewport.height));
          const viewport = page.getViewport({ scale: 2 * scale });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d", { alpha: false });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: context, viewport }).promise;
          imageSource = canvas;
        }

        setOcr((value) => ({ ...value, current: label }));
        const result = await recognize(imageSource, "eng+kor", {
          logger: ({ status, progress }) => {
            if (status === "recognizing text") {
              setOcr({
                active: true,
                current: label,
                progress: Math.round(((index + progress) / sources.length) * 100),
              });
            }
          },
        });
        chunks.push(result.data.text);
      }
      setText((value) => normalizeText([value, ...chunks].filter(Boolean).join("\n")));
    } catch (error) {
      console.error(error);
      alert("문장을 읽지 못했습니다. 이미지가 선명한지 확인하거나 직접 입력해 주세요.");
    } finally {
      setOcr({ active: false, progress: 100, current: "" });
    }
  }

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
    runOcr(selected);
    event.target.value = "";
  }

  function startQuiz() {
    if (!sentences.length) return;
    const ratio = DIFFICULTIES.find(({ level }) => level === difficulty).ratio;
    setQuestions(shuffle(sentences).map((sentence) => makeQuestion(sentence, ratio)));
    setCurrent(0);
    setAnswers({});
    setRevealed(new Set());
    setChecked(false);
    setResults([]);
    setScreen("quiz");
    window.scrollTo(0, 0);
  }

  function answerKey(index) {
    return `${current}-${index}`;
  }

  function isCorrect(index) {
    return cleanAnswer(answers[answerKey(index)] || "") === cleanAnswer(question.tokens[index]);
  }

  function completeQuestion() {
    let correct = 0;
    question.blanks.forEach((index) => {
      if (mode === "tap" || isCorrect(index)) correct += 1;
    });
    const result = { correct, total: question.blanks.size };
    const nextResults = [...results, result];
    setResults(nextResults);

    if (current === questions.length - 1) {
      setScreen("result");
      return;
    }
    setCurrent((value) => value + 1);
    setAnswers({});
    setRevealed(new Set());
    setChecked(false);
    window.scrollTo(0, 0);
  }

  const totalCorrect = results.reduce((sum, result) => sum + result.correct, 0);
  const totalBlanks = results.reduce((sum, result) => sum + result.total, 0);

  if (screen === "result") {
    const score = totalBlanks ? Math.round((totalCorrect / totalBlanks) * 100) : 100;
    return (
      <main className="app result-screen">
        <ThemeButton theme={theme} setTheme={setTheme} />
        <div className="result-mark"><Icon name="spark" size={34} /></div>
        <p className="eyebrow">학습 완료</p>
        <h1>{score}<span>점</span></h1>
        <p className="result-copy">{questions.length}개 문장을 모두 풀었어요.<br />빈칸 {totalBlanks}개 중 {totalCorrect}개를 맞혔습니다.</p>
        <div className="score-bar"><i style={{ width: `${score}%` }} /></div>
        <button className="primary" onClick={startQuiz}><Icon name="refresh" /> 같은 문장 다시 풀기</button>
        <button className="secondary" onClick={() => setScreen("setup")}>문장 편집하기</button>
      </main>
    );
  }

  if (screen === "quiz" && question) {
    const allAnswered = [...question.blanks].every((index) => answers[answerKey(index)]?.trim());
    const allRevealed = [...question.blanks].every((index) => revealed.has(index));
    return (
      <main className="app quiz-screen">
        <header className="quiz-header">
          <button className="icon-button" onClick={() => setScreen("setup")} aria-label="돌아가기"><Icon name="back" /></button>
          <div className="quiz-progress">
            <div><span>문장 {current + 1}</span><b>{questions.length}</b></div>
            <div className="progress-track"><i style={{ width: `${((current + 1) / questions.length) * 100}%` }} /></div>
          </div>
          <ThemeButton theme={theme} setTheme={setTheme} />
        </header>

        <section className="quiz-card">
          <p className="eyebrow">{mode === "write" ? "빈칸에 알맞은 단어를 입력하세요" : "빈칸을 눌러 정답을 확인하세요"}</p>
          <div className={`sentence ${mode}`}>
            {question.tokens.map((token, index) => {
              const blank = question.blanks.has(index);
              if (!blank) return <span className="word" key={`${token}-${index}`}>{token}</span>;
              if (mode === "tap") {
                const open = revealed.has(index);
                return (
                  <button
                    className={`tap-blank ${open ? "revealed" : ""}`}
                    key={`${token}-${index}`}
                    onClick={() => setRevealed((value) => new Set([...value, index]))}
                  >
                    {open ? token : "눌러보기"}
                  </button>
                );
              }
              return (
                <input
                  key={`${token}-${index}`}
                  className={checked ? (isCorrect(index) ? "correct" : "wrong") : ""}
                  value={answers[answerKey(index)] || ""}
                  onChange={(event) => setAnswers((value) => ({ ...value, [answerKey(index)]: event.target.value }))}
                  style={{ width: `${Math.max(72, token.length * 18 + 28)}px` }}
                  autoCapitalize="none"
                  autoComplete="off"
                  aria-label="빈칸 답"
                />
              );
            })}
          </div>
          {checked && mode === "write" && (
            <div className="answer-note">
              <Icon name="check" />
              <span>정답: {[...question.blanks].map((index) => question.tokens[index]).join(" · ")}</span>
            </div>
          )}
        </section>

        <div className="quiz-actions">
          {mode === "write" && !checked && (
            <button className="primary" disabled={!allAnswered} onClick={() => setChecked(true)}>정답 확인 <Icon name="arrow" /></button>
          )}
          {((mode === "write" && checked) || (mode === "tap" && allRevealed)) && (
            <button className="primary" onClick={completeQuestion}>{current === questions.length - 1 ? "결과 보기" : "다음 문장"} <Icon name="arrow" /></button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="app setup-screen">
      <header className="brand-row">
        <a className="brand" href="/" aria-label="문장틈 홈"><span>문장</span>틈<i /></a>
        <ThemeButton theme={theme} setTheme={setTheme} />
      </header>

      <section className="intro">
        <p className="eyebrow"><Icon name="spark" size={15} /> 나만의 빈칸 학습</p>
        <h1>문장을 넣고,<br /><em>기억을 꺼내보세요.</em></h1>
        <p>사진 속 문장을 읽어 빈칸 문제로 바꿔드려요.<br />영어와 한국어를 모두 인식합니다.</p>
      </section>

      <section className="panel source-panel">
        <div className="section-title">
          <span>01</span><div><h2>문장 가져오기</h2><p>사진을 올리거나 직접 입력하세요</p></div>
        </div>

        <input ref={fileInput} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={handleFiles} />
        <button className={`drop-zone ${ocr.active ? "loading" : ""}`} onClick={() => !ocr.active && fileInput.current?.click()}>
          <span className="upload-icon"><Icon name={ocr.active ? "spark" : "upload"} size={26} /></span>
          {ocr.active ? (
            <>
              <strong>문장을 읽고 있어요 · {ocr.progress}%</strong>
              <small>{ocr.current}</small>
              <span className="ocr-track"><i style={{ width: `${ocr.progress}%` }} /></span>
            </>
          ) : (
            <>
              <strong>사진 또는 PDF 선택하기</strong>
              <small>여러 파일도 한 번에 가능해요 · JPG, PNG, HEIC, PDF</small>
              {files.length > 0 && <span className="file-count"><Icon name="image" size={15} /> {files.length}개 불러옴</span>}
            </>
          )}
        </button>

        <div className="divider"><span>또는 직접 입력</span></div>
        <label className="text-box">
          <span><Icon name="pen" size={16} /> 문장 입력</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"한 줄에 한 문장씩 입력해 주세요.\n영어와 한국어 모두 사용할 수 있어요."}
          />
          <footer>
            <span>{sentences.length}개 문장 인식</span>
            {!text && <button type="button" onClick={() => setText(SAMPLE_TEXT)}>예시 채우기</button>}
            {text && <button type="button" onClick={() => setText("")}>전체 지우기</button>}
          </footer>
        </label>
      </section>

      <section className="panel">
        <div className="section-title">
          <span>02</span><div><h2>학습 설정</h2><p>원하는 방식으로 문제를 만들어요</p></div>
        </div>

        <div className="setting-block">
          <div className="setting-label"><b>난이도</b><span>빈칸이 만들어지는 비율</span></div>
          <div className="difficulty">
            {DIFFICULTIES.map((item) => (
              <button key={item.level} className={difficulty === item.level ? "active" : ""} onClick={() => setDifficulty(item.level)}>
                <b>{item.level}</b><span>{item.label}</span>
              </button>
            ))}
          </div>
          <p className="difficulty-help">현재 문장 단어의 약 {Math.round(DIFFICULTIES[difficulty - 1].ratio * 100)}%가 빈칸으로 나옵니다.</p>
        </div>

        <div className="setting-block">
          <div className="setting-label"><b>학습 모드</b><span>답을 확인하는 방법</span></div>
          <div className="mode-grid">
            <button className={mode === "write" ? "active" : ""} onClick={() => setMode("write")}>
              <span className="radio" /><Icon name="pen" /><div><b>직접 입력</b><small>답을 타이핑해 채워요</small></div>
            </button>
            <button className={mode === "tap" ? "active" : ""} onClick={() => setMode("tap")}>
              <span className="radio" /><Icon name="check" /><div><b>눌러서 확인</b><small>빈칸을 눌러 답을 봐요</small></div>
            </button>
          </div>
        </div>
      </section>

      <button className="primary start-button" disabled={!sentences.length || ocr.active} onClick={startQuiz}>
        {sentences.length ? `${sentences.length}개 문장으로 시작` : "문장을 먼저 추가해 주세요"} <Icon name="arrow" />
      </button>
      <p className="privacy">사진과 문장은 기기 안에서만 처리됩니다.</p>
    </main>
  );
}

function ThemeButton({ theme, setTheme }) {
  return (
    <button className="theme-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="테마 변경">
      <Icon name={theme === "light" ? "moon" : "sun"} />
    </button>
  );
}

createRoot(document.getElementById("root")).render(<App />);
