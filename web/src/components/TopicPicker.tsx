import { useId } from "react";
import type { Topic } from "../lib/protocol";
import "./components.css";

export const TOPIC_OPTIONS: readonly { id: Topic; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "saludos", label: "Saludos" },
  { id: "salud", label: "Salud" },
  { id: "emergencias", label: "Emergencias" },
];

export interface TopicPickerProps {
  value: Topic;
  onChange(topic: Topic): void;
}

/**
 * Tema de la conversación (Interpretación): control segmentado hecho con radios nativos, así las flechas,
 * Tab y el lector de pantalla funcionan sin código extra. Las señas del tema elegido ganan en los empates.
 */
export function TopicPicker({ value, onChange }: TopicPickerProps) {
  const name = useId();
  return (
    <fieldset className="topic-picker">
      <legend className="topic-picker__legend">Tema de la conversación</legend>
      <div className="segmented topic-picker__options">
        {TOPIC_OPTIONS.map((o) => (
          <label key={o.id} className="segmented__item topic-picker__item">
            <input
              className="visually-hidden"
              type="radio"
              name={name}
              value={o.id}
              checked={value === o.id}
              onChange={() => onChange(o.id)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
