import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eraser, SendHorizontal, Terminal } from 'lucide-react';
import type { UartListener } from '../useBoardSim';
import { appendTerminalText, bytesToHex, encodeUartText, parseHexBytes } from '../display';

export const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1_000_000, 2_000_000];
const MAX_BYTES = 256 * 1024;
const ICON = { size: 15, strokeWidth: 1.75 };

type Eol = 'none' | 'lf' | 'crlf' | 'cr';

export interface UartTerminalProps {
  hasTx: boolean;
  hasRx: boolean;
  txName: string | null;
  rxName: string | null;
  baud: number;
  onBaud: (b: number) => void;
  /** 每位周期数（freq / baud） */
  bitPeriod: number;
  rxPending: number;
  running: boolean;
  subscribe: (fn: UartListener) => () => void;
  onSend: (bytes: number[]) => void;
  onClearQueue: () => void;
}

export function UartTerminal(p: UartTerminalProps) {
  const [mode, setMode] = useState<'text' | 'hex'>('text');
  const [text, setText] = useState('');
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState(0);
  const [total, setTotal] = useState(0);
  const [input, setInput] = useState('');
  const [eol, setEol] = useState<Eol>('lf');
  const [sendHex, setSendHex] = useState(false);
  const [inputErr, setInputErr] = useState(false);
  const bytes = useRef<number[]>([]);
  const decoder = useRef<TextDecoder | null>(null);
  const outRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const { subscribe } = p;

  useEffect(() => {
    if (!decoder.current) decoder.current = new TextDecoder('utf-8', { fatal: false });
    return subscribe((chunk, errs) => {
      if (chunk.length) {
        const buf = bytes.current;
        for (const b of chunk) buf.push(b);
        if (buf.length > MAX_BYTES) buf.splice(0, buf.length - MAX_BYTES);
        const s = decoder.current!.decode(Uint8Array.from(chunk), { stream: true });
        setText((t) => appendTerminalText(t, s));
        setTotal((n) => n + chunk.length);
        setVersion((v) => v + 1);
      }
      if (errs) setErrors((e) => e + errs);
    });
  }, [subscribe]);

  const hexView = useMemo(() => {
    if (mode !== 'hex') return '';
    const buf = bytes.current;
    const start = Math.max(0, buf.length - 16 * 2048);
    const lines: string[] = [];
    for (let i = start - (start % 16); i < buf.length; i += 16) {
      lines.push(`${i.toString(16).toUpperCase().padStart(6, '0')}  ${bytesToHex(buf.slice(i, i + 16))}`);
    }
    return lines.join('\n');
    // version 变化即缓冲区变化
  }, [mode, version]);

  useLayoutEffect(() => {
    const el = outRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text, hexView, mode]);

  const clear = () => {
    bytes.current = [];
    decoder.current = new TextDecoder('utf-8', { fatal: false });
    setText('');
    setErrors(0);
    setTotal(0);
    setVersion((v) => v + 1);
  };

  const send = () => {
    let data: number[] | null;
    if (sendHex) data = parseHexBytes(input);
    else data = input || eol !== 'none' ? encodeUartText(input, eol) : null;
    if (!data || !data.length) {
      setInputErr(sendHex && input.trim() !== '');
      return;
    }
    setInputErr(false);
    p.onSend(data);
    setInput('');
  };

  const periodBad = p.bitPeriod < 4;
  const content = mode === 'text' ? text : hexView;

  return (
    <div className="panel vb-uart">
      <div className="panel-header">
        <Terminal {...ICON} className="ico" aria-hidden />
        <span className="vb-panel-title">串口终端</span>
        <span className="spacer" />
        <select className="input vb-baud" value={p.baud} onChange={(e) => p.onBaud(Number(e.target.value))} aria-label="波特率" title="波特率（8N1）">
          {(BAUD_RATES.includes(p.baud) ? BAUD_RATES : [...BAUD_RATES, p.baud].sort((a, b) => a - b)).map((b) => (
            <option key={b} value={b}>
              {b.toLocaleString()} bps
            </option>
          ))}
        </select>
        <div className="seg vb-seg-sm" role="tablist" aria-label="显示格式">
          <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
            文本
          </button>
          <button type="button" className={mode === 'hex' ? 'active' : ''} onClick={() => setMode('hex')}>
            HEX
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={clear} title="清空接收区" aria-label="清空接收区">
          <Eraser {...ICON} />
        </button>
      </div>
      <div className={`vb-uart-info${periodBad ? ' bad' : ''}`}>
        <span className="vb-uart-pins">
          {[p.txName && `TX ${p.txName}`, p.rxName && `RX ${p.rxName}`].filter(Boolean).join(' · ')}
        </span>
        {periodBad ? (
          <>设计时钟相对波特率过低（每位 {p.bitPeriod.toFixed(2)} 个周期），无法可靠通信。请提高设计时钟频率或降低波特率。</>
        ) : (
          <>
            8N1 · 每位 {p.bitPeriod >= 100 ? Math.round(p.bitPeriod) : p.bitPeriod.toFixed(1)} 个周期 · 已收 {total.toLocaleString()} 字节
            {errors > 0 && <span className="vb-uart-err"> · 帧错误 {errors}</span>}
            {p.rxPending > 0 && (
              <>
                {' '}
                · 待发送 {p.rxPending}
                <button type="button" className="vb-link" onClick={p.onClearQueue}>
                  取消
                </button>
              </>
            )}
          </>
        )}
      </div>
      <pre
        ref={outRef}
        className="vb-uart-out"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        aria-live="off"
      >
        {content || (
          <span className="vb-uart-empty">
            {p.hasTx ? (p.running ? `等待 ${p.txName ?? 'tx'} 输出…` : '运行仿真后，设计从 TX 发出的数据会显示在这里') : '设计没有 tx / uart_tx 输出端口'}
          </span>
        )}
      </pre>
      {p.hasRx && (
        <form
          className="vb-uart-send"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className={`input${inputErr ? ' vb-input-err' : ''}`}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setInputErr(false);
            }}
            placeholder={sendHex ? '十六进制字节，如 48 65 6C' : `发送到 ${p.rxName ?? 'rx'}…`}
            aria-label="发送内容"
            spellCheck={false}
          />
          <select className="input vb-eol" value={sendHex ? 'hex' : eol} onChange={(e) => {
            if (e.target.value === 'hex') setSendHex(true);
            else {
              setSendHex(false);
              setEol(e.target.value as Eol);
            }
          }} aria-label="行尾 / 格式">
            <option value="none">无行尾</option>
            <option value="lf">LF</option>
            <option value="crlf">CRLF</option>
            <option value="cr">CR</option>
            <option value="hex">HEX 字节</option>
          </select>
          <button type="submit" className="btn btn-sm btn-primary" disabled={periodBad} title="以 8N1 帧发送到设计的 RX">
            <SendHorizontal {...ICON} size={14} />
            发送
          </button>
        </form>
      )}
    </div>
  );
}
