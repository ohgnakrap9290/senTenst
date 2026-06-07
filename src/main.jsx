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

const STORAGE_KEY = "sentenst-sentence-sets";

function readStorage(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadSavedSets() {
  try {
    const stored = JSON.parse(readStorage(STORAGE_KEY, "[]"));
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

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

function splitSentenceLine(line) {
  const sentences = [];
  let current = "";

  for (const character of line) {
    current += character;
    if (/[.!?。！？]/u.test(character)) {
      if (current.trim()) sentences.push(current.trim());
      current = "";
    }
  }

  if (current.trim()) sentences.push(current.trim());
  return sentences;
}

function extractSentences(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const lines = normalized
    .split(/\n+/)
    .flatMap(splitSentenceLine)
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
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    save: (
      <>
        <path d="M5 3h12l2 2v16H5V3Z" />
        <path d="M8 3v6h8V3M8 21v-7h8v7" />
      </>
    ),
    trash: <path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function App() {
  const [theme, setTheme] = useState(() => readStorage("theme", "light"));
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
  const [unknown, setUnknown] = useState(false);
  const [hintCounts, setHintCounts] = useState({});
  const [setName, setSetName] = useState("");
  const [savedSets, setSavedSets] = useState(loadSavedSets);
  const fileInput = useRef(null);

  const sentences = useMemo(() => extractSentences(text), [text]);
  const question = questions[current];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage("theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#171815" : "#f4f2ec",
    );
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle("quiz-active", screen === "quiz");
    return () => document.body.classList.remove("quiz-active");
  }, [screen]);

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
    setUnknown(false);
    setHintCounts({});
    setScreen("quiz");
    window.scrollTo(0, 0);
  }

  function startWrongReview() {
    const wrongQuestions = results.filter((result) => result.wrong).map((result) => result.question);
    if (!wrongQuestions.length) return;
    setQuestions(shuffle(wrongQuestions));
    setCurrent(0);
    setAnswers({});
    setRevealed(new Set());
    setChecked(false);
    setResults([]);
    setUnknown(false);
    setHintCounts({});
    setScreen("quiz");
    window.scrollTo(0, 0);
  }

  function persistSets(nextSets) {
    setSavedSets(nextSets);
    writeStorage(STORAGE_KEY, JSON.stringify(nextSets));
  }

  function saveSentenceSet() {
    const name = setName.trim();
    if (!name || !sentences.length) return;

    const nextSet = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      name,
      text: normalizeText(text),
      sentenceCount: sentences.length,
      savedAt: new Date().toISOString(),
    };
    persistSets([nextSet, ...savedSets]);
    setSetName("");
  }

  function loadSentenceSet(savedSet) {
    setText(savedSet.text);
    setFiles([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteSentenceSet(id) {
    persistSets(savedSets.filter((savedSet) => savedSet.id !== id));
  }

  function answerKey(index) {
    return `${current}-${index}`;
  }

  function isCorrect(index) {
    return cleanAnswer(answers[answerKey(index)] || "") === cleanAnswer(question.tokens[index]);
  }

  function revealNextHint() {
    const blankIndexes = [...question.blanks];
    const target = blankIndexes.find((index) => {
      const answerLength = Array.from(cleanAnswer(question.tokens[index])).length;
      return (hintCounts[index] || 0) < answerLength;
    });
    if (target === undefined) return;
    setHintCounts((value) => ({ ...value, [target]: (value[target] || 0) + 1 }));
  }

  function hintFor(index) {
    const answer = Array.from(cleanAnswer(question.tokens[index]));
    const count = hintCounts[index] || 0;
    return answer.map((character, characterIndex) => (characterIndex < count ? character : "＿")).join("");
  }

  function completeQuestion() {
    let correct = 0;
    question.blanks.forEach((index) => {
      if ((mode === "tap" && !unknown) || (mode === "write" && isCorrect(index))) correct += 1;
    });
    const wrong = mode === "tap" ? unknown : correct < question.blanks.size;
    const result = { correct, total: question.blanks.size, wrong, question };
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
    setUnknown(false);
    setHintCounts({});
    window.scrollTo(0, 0);
  }

  const totalCorrect = results.reduce((sum, result) => sum + result.correct, 0);
  const totalBlanks = results.reduce((sum, result) => sum + result.total, 0);
  const wrongCount = results.filter((result) => result.wrong).length;

  if (screen === "result") {
    const score = totalBlanks ? Math.round((totalCorrect / totalBlanks) * 100) : 100;
    return (
      <main className="app result-screen">
        <ThemeButton theme={theme} setTheme={setTheme} />
        <div className="result-mark"><Icon name="spark" size={34} /></div>
        <p className="eyebrow">학습 완료</p>
        <h1>{score}<span>점</span></h1>
        <p className="result-copy">
          {questions.length}개 문장을 모두 풀었어요.<br />
          {wrongCount > 0 ? `틀리거나 모른 문장이 ${wrongCount}개 있어요.` : "모든 문장을 알고 있어요."}
        </p>
        <div className="score-bar"><i style={{ width: `${score}%` }} /></div>
        {wrongCount > 0 && (
          <button className="primary" onClick={startWrongReview}><Icon name="refresh" /> 틀린 문장만 계속하기</button>
        )}
        <button className={wrongCount > 0 ? "secondary" : "primary"} onClick={() => setScreen("setup")}>학습 끝내기</button>
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
          {Object.values(hintCounts).some(Boolean) && (
            <div className="hint-note">
              <span>힌트</span>
              <b>{[...question.blanks].map((index) => hintFor(index)).join(" · ")}</b>
            </div>
          )}
          {!checked && (
            <button className="hint-button" onClick={revealNextHint}>
              <Icon name="spark" size={16} /> 힌트 한 글자 보기
            </button>
          )}
        </section>

        <div className="quiz-actions">
          {mode === "tap" && (
            <button
              className={`unknown-button ${unknown ? "active" : ""}`}
              onClick={() => setUnknown((value) => !value)}
            >
              <span className="unknown-check">{unknown && <Icon name="check" size={14} />}</span>
              이 문장은 몰라요
            </button>
          )}
          {mode === "write" && !checked && (
            <button className="primary" disabled={!allAnswered} onClick={() => setChecked(true)}>정답 확인 <Icon name="arrow" /></button>
          )}
          {((mode === "write" && checked) || (mode === "tap" && (allRevealed || unknown))) && (
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
          <span>02</span><div><h2>문장 보관함</h2><p>이름을 붙여 이 기기에 저장하세요</p></div>
        </div>

        <div className="save-set">
          <label>
            <span>문장 세트 이름</span>
            <input
              value={setName}
              onChange={(event) => setSetName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveSentenceSet();
              }}
              placeholder="예: 영어 수행평가 1단원"
              maxLength={40}
            />
          </label>
          <button
            className="save-button"
            disabled={!setName.trim() || !sentences.length || ocr.active}
            onClick={saveSentenceSet}
          >
            <Icon name="save" size={18} /> 저장
          </button>
        </div>

        {savedSets.length > 0 ? (
          <div className="saved-list">
            {savedSets.map((savedSet) => (
              <article className="saved-item" key={savedSet.id}>
                <button className="saved-main" onClick={() => loadSentenceSet(savedSet)}>
                  <span className="saved-icon"><Icon name="folder" size={19} /></span>
                  <span>
                    <b>{savedSet.name}</b>
                    <small>
                      {savedSet.sentenceCount}개 문장 · {new Intl.DateTimeFormat("ko-KR", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }).format(new Date(savedSet.savedAt))}
                    </small>
                  </span>
                </button>
                <button className="delete-button" onClick={() => deleteSentenceSet(savedSet.id)} aria-label={`${savedSet.name} 삭제`}>
                  <Icon name="trash" size={17} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-library">
            <Icon name="folder" size={23} />
            <span>아직 저장한 문장 세트가 없어요.</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <span>03</span><div><h2>학습 설정</h2><p>원하는 방식으로 문제를 만들어요</p></div>
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
