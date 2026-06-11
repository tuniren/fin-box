import { FileText, FolderOpen, Plus, Power } from "lucide-react";

type TickerMenuProps = {
  onConfig: () => void;
  onDir: () => void;
  onAdd: () => void;
  onQuit: () => void;
};

export function TickerMenu({ onConfig, onDir, onAdd, onQuit }: TickerMenuProps) {
  return (
    <section className="menu-pane no-drag">
      <button onClick={onConfig}>
        <FileText size={15} />
        Open Config
      </button>
      <button onClick={onDir}>
        <FolderOpen size={15} />
        Open Folder
      </button>
      <button onClick={onAdd}>
        <Plus size={15} />
        Add Symbol
      </button>
      <button onClick={onQuit}>
        <Power size={15} />
        Quit
      </button>
    </section>
  );
}
