"use client";

import { useId, useState } from "react";
import {
  ArrowRight,
  Check,
  Hand,
  Keyboard,
  Leaf,
  MousePointer2,
  PanelsTopLeft,
  Shield,
} from "lucide-react";
import { type Mode } from "@/lib/records";
import { Dialog } from "./dialog";

export function ModeDialog({
  mode,
  showMessages,
  onSave,
  onClose,
}: {
  mode: Mode;
  showMessages: boolean;
  onSave: (mode: Mode, messages: boolean) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(mode);
  const [messages, setMessages] = useState(showMessages);
  const labelId = useId();
  return (
    <Dialog labelId={labelId} onClose={onClose}>
      <span className="eyebrow">YOUR PACE, YOUR SPACE.</span>
      <h2 id={labelId}>
        何もしないにも、
        <br />
        自分のペースを。
      </h2>
      <p className="dialog-description">今日の気分で、モードを選びましょう。</p>
      <fieldset className="mode-options">
        <legend className="sr-only">計測モード</legend>
        <label
          className={`mode-option ${selected === "relaxed" ? "selected" : ""}`}
        >
          <input
            type="radio"
            name="mode"
            value="relaxed"
            checked={selected === "relaxed"}
            onChange={() => setSelected("relaxed")}
          />
          <span className="mode-icon">
            <Leaf size={23} strokeWidth={1.5} />
          </span>
          <span className="mode-option-copy">
            <strong>
              ゆるモード <small>おすすめ</small>
            </strong>
            <span>
              ちょっと動いても、大丈夫。
              <br />
              終了ボタンを押すまで、記録します。
            </span>
          </span>
          <span className="radio-mark" aria-hidden="true">
            {selected === "relaxed" && <Check size={13} />}
          </span>
        </label>
        <label
          className={`mode-option ${selected === "strict" ? "selected" : ""}`}
        >
          <input
            type="radio"
            name="mode"
            value="strict"
            checked={selected === "strict"}
            onChange={() => setSelected("strict")}
          />
          <span className="mode-icon">
            <Shield size={23} strokeWidth={1.5} />
          </span>
          <span className="mode-option-copy">
            <strong>厳格モード</strong>
            <span>
              小さな動きも、見逃しません。
              <br />
              画面への操作を検知すると終了します。
            </span>
          </span>
          <span className="radio-mark" aria-hidden="true">
            {selected === "strict" && <Check size={13} />}
          </span>
        </label>
      </fieldset>
      <div className="strict-rules">
        <span>
          <Hand size={14} />
          タップ
        </span>
        <span>
          <MousePointer2 size={14} />
          マウス
        </span>
        <span>
          <Keyboard size={14} />
          キー入力
        </span>
        <span>
          <PanelsTopLeft size={14} />
          タブ移動
        </span>
      </div>
      <p className="mode-note">
        厳格モードは3秒の準備後に開始。手をそっと離してください。
      </p>
      <label className="message-option">
        <input
          type="checkbox"
          checked={messages}
          onChange={(event) => setMessages(event.target.checked)}
        />
        <span>記録中、たまにひとことを表示する</span>
      </label>
      <button
        className="primary-button wide"
        onClick={() => {
          onSave(selected, messages);
          onClose();
        }}
      >
        このモードにする
        <ArrowRight size={18} />
      </button>
    </Dialog>
  );
}
