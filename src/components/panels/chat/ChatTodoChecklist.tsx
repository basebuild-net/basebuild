import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import type { NativeTodoItem } from "../../../lib/native-chat";
import { t } from "../../../i18n";

type ChatTodoChecklistProps = {
  todos: NativeTodoItem[];
};

/** The checklist the agent keeps for the current chat, shown above the composer. */
export function ChatTodoChecklist({ todos }: ChatTodoChecklistProps) {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  return (
    <section className="chat-todo-checklist" aria-label={t("chatTodoChecklist.agentChecklist")} title={t("chatTodoChecklist.checklistTheAgentKeepsForThis")}>
      <header className="chat-todo-header">
        {t("chatTodoChecklist.checklist")} {completed}/{todos.length}
      </header>
      <ul className="chat-todo-list">
        {todos.map((todo, index) => (
          <li key={index} className={`chat-todo-item is-${todo.status}`}>
            {todo.status === "completed" ? <CheckCircle2 size={13} /> : null}
            {todo.status === "in_progress" ? <CircleDot size={13} /> : null}
            {todo.status === "pending" ? <Circle size={13} /> : null}
            <span>{todo.content}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
