import { Tree } from "antd";
import "antd/dist/reset.css";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TreeDataNode } from "antd";
import { Folder, Plus } from "lucide-react";
import { displayName } from "../../shared/finance";
import { profitColor } from "../../shared/theme";
import type { StockStatus, Theme } from "../../shared/types";
import { formatSigned, stockPercent } from "../utils";

const WATCH_ROOT_KEY = "watch-root";

type WatchNodeType = "root" | "group" | "stock" | "empty";

type WatchTreeNode = TreeDataNode & {
  nodeType: WatchNodeType;
  tag?: string;
  sourceTag?: string;
  stock?: StockStatus;
};

export type WatchTreeSelection = { type: "group"; tag: string } | { type: "stock"; tag: string; code: string };

export function GroupedWatchlist({
  stocks,
  groupNames,
  groupOrder,
  selectedCode,
  selectedSelection,
  theme,
  onCreateGroup,
  onAddStockToGroup,
  onMoveStockToGroup,
  onReorderGroups,
  onSelectNode,
  onSelect,
  onOpenDetails,
  readOnly = false
}: {
  stocks: StockStatus[];
  groupNames: string[];
  groupOrder: Record<string, string[]>;
  selectedCode?: string;
  selectedSelection?: WatchTreeSelection;
  theme: Theme;
  onCreateGroup?: () => void;
  onAddStockToGroup?: (tag: string) => void;
  onMoveStockToGroup?: (code: string, sourceTag: string, targetTag: string, copy: boolean, sourceOrder: string[], targetOrder: string[]) => void;
  onReorderGroups?: (groups: string[]) => void;
  onSelectNode?: (selection: WatchTreeSelection) => void;
  onSelect: (stock: StockStatus) => void;
  onOpenDetails?: (stock: StockStatus) => void;
  readOnly?: boolean;
}) {
  const groups = useMemo(() => groupStocksByTag(stocks, groupNames, groupOrder), [stocks, groupNames, groupOrder]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([WATCH_ROOT_KEY]);
  const selectedWatchKey = watchSelectionKey(selectedSelection);

  const treeData = useMemo<WatchTreeNode[]>(() => [
    {
      key: WATCH_ROOT_KEY,
      title: "root",
      nodeType: "root",
      selectable: false,
      children: groups.map((group) => ({
        key: watchGroupKey(group.tag),
        title: group.tag,
        nodeType: "group" as const,
        tag: group.tag,
        selectable: true,
        isLeaf: false,
        children: group.stocks.length
          ? group.stocks.map((stock) => ({
              key: watchStockKey(group.tag, stock.config.code),
              title: displayName(stock),
              nodeType: "stock" as const,
              tag: group.tag,
              sourceTag: group.tag,
              stock,
              selectable: true,
              isLeaf: true
            }))
          : [
              {
                key: `${watchGroupKey(group.tag)}::empty`,
                title: "Drop symbols here or use +",
                nodeType: "empty" as const,
                tag: group.tag,
                selectable: false,
                disabled: true,
                isLeaf: true
              }
            ]
      }))
    }
  ], [groups]);

  const selectNode = (node: WatchTreeNode) => {
    if (node.nodeType === "group" && node.tag) {
      onSelectNode?.({ type: "group", tag: node.tag });
      return;
    }

    if (node.nodeType === "stock" && node.stock && node.sourceTag) {
      onSelect(node.stock);
      onSelectNode?.({ type: "stock", tag: node.sourceTag, code: node.stock.config.code });
    }
  };

  const handleDrop = (info: any) => {
    const dropPosition = relativeDropPosition(info);
    const draggedGroup = parseWatchGroupKey(String(info.dragNode.key));
    if (draggedGroup) {
      const targetGroup = parseWatchGroupKey(String(info.node.key));
      if (!targetGroup || targetGroup === draggedGroup || !onReorderGroups || dropPosition === 0) return;
      const nextGroups = groups.map((group) => group.tag).filter((tag) => tag !== draggedGroup);
      const targetIndex = nextGroups.indexOf(targetGroup);
      nextGroups.splice(Math.max(0, targetIndex + (dropPosition > 0 ? 1 : 0)), 0, draggedGroup);
      onReorderGroups(nextGroups);
      return;
    }
    const payload = parseWatchStockKey(String(info.dragNode.key));
    if (!payload || !onMoveStockToGroup) return;

    const targetStock = parseWatchStockKey(String(info.node.key));
    if (targetStock?.sourceTag === payload.sourceTag && targetStock.code.toLowerCase() === payload.code.toLowerCase()) return;
    const targetTag = parseWatchGroupKey(String(info.node.key)) ?? targetStock?.sourceTag;
    if (!targetTag) return;

    const copy = Boolean(info.event.ctrlKey || info.event.altKey || info.event.shiftKey);
    const sourceOrder = groups.find((group) => group.tag === payload.sourceTag)?.stocks.map((stock) => stock.config.code) ?? [];
    const targetOrder = groups.find((group) => group.tag === targetTag)?.stocks.map((stock) => stock.config.code) ?? [];
    const nextSourceOrder = sourceOrder.filter((code) => code.toLowerCase() !== payload.code.toLowerCase());
    const nextTargetOrder = targetOrder.filter((code) => code.toLowerCase() !== payload.code.toLowerCase());

    if (targetStock) {
      const targetIndex = nextTargetOrder.findIndex((code) => code.toLowerCase() === targetStock.code.toLowerCase());
      const insertAt = Math.max(0, targetIndex + (dropPosition > 0 ? 1 : 0));
      nextTargetOrder.splice(insertAt, 0, payload.code);
    } else {
      nextTargetOrder.push(payload.code);
    }

    onMoveStockToGroup(
      payload.code,
      payload.sourceTag,
      targetTag,
      copy,
      payload.sourceTag === targetTag ? nextTargetOrder : nextSourceOrder,
      nextTargetOrder
    );
  };

  const handleSelect = (_keys: unknown[], info: any) => {
    selectNode(info.node as WatchTreeNode);
  };

  const renderTitle = (node: WatchTreeNode) => {
    if (node.nodeType === "root") {
      return <WatchRootTitle groupCount={groups.length} onCreateGroup={readOnly ? undefined : onCreateGroup} />;
    }

    if (node.nodeType === "group" && node.tag) {
      return (
        <WatchGroupTitle
          tag={node.tag}
          onSelect={() => selectNode(node)}
          onAddStockToGroup={readOnly || !onAddStockToGroup ? undefined : () => onAddStockToGroup(node.tag!)}
        />
      );
    }

    if (node.nodeType === "stock" && node.stock && node.sourceTag) {
      return (
        <WatchStockTitle
          stock={node.stock}
          selected={node.stock.config.code === selectedCode}
          theme={theme}
          onSelect={() => selectNode(node)}
          onOpenDetails={onOpenDetails ? () => onOpenDetails(node.stock!) : undefined}
        />
      );
    }

    return <span className="watch-tree-empty">Drop symbols here or use +</span>;
  };

  return (
    <Tree<WatchTreeNode>
      className="watch-tree"
      blockNode
      draggable={!readOnly && (onMoveStockToGroup || onReorderGroups) ? {
        icon: false,
        nodeDraggable: (node) => Boolean(
          (onMoveStockToGroup && parseWatchStockKey(String(node.key))) ||
          (onReorderGroups && parseWatchGroupKey(String(node.key)))
        )
      } : false}
      allowDrop={({ dragNode, dropNode, dropPosition }) =>
        !readOnly && (
          (dropPosition === 0 && parseWatchGroupKey(String(dropNode.key)) !== undefined && parseWatchStockKey(String(dragNode.key)) !== undefined) ||
          (dropPosition !== 0 && parseWatchStockKey(String(dropNode.key)) !== undefined && parseWatchStockKey(String(dragNode.key)) !== undefined) ||
          (dropPosition !== 0 && parseWatchGroupKey(String(dropNode.key)) !== undefined && parseWatchGroupKey(String(dragNode.key)) !== undefined)
        )
      }
      expandedKeys={expandedKeys}
      treeData={treeData}
      titleRender={renderTitle}
      selectedKeys={selectedWatchKey ? [selectedWatchKey] : []}
      onDrop={handleDrop}
      onSelect={handleSelect}
      onExpand={(keys) => setExpandedKeys(keys.map(String))}
    />
  );
}

function relativeDropPosition(info: { dropPosition: number; node: { pos?: string } }): number {
  const positionParts = String(info.node.pos ?? "").split("-");
  const positionIndex = Number(positionParts[positionParts.length - 1]);
  return Number.isFinite(positionIndex) ? info.dropPosition - positionIndex : info.dropPosition;
}
function stopTreeEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function runTreeAction(event: { preventDefault: () => void; stopPropagation: () => void }, action: () => void) {
  event.preventDefault();
  event.stopPropagation();
  action();
}

function TreeActionButton({ title, ariaLabel, onAction, children }: { title: string; ariaLabel: string; onAction: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      draggable={false}
      className="watch-tree-action"
      onPointerDown={stopTreeEvent}
      onMouseDown={stopTreeEvent}
      onClick={(event) => runTreeAction(event, onAction)}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

function WatchRootTitle({ groupCount, onCreateGroup }: { groupCount: number; onCreateGroup?: () => void }) {
  return (
    <div className="watch-tree-title watch-tree-root-title">
      <span className="watch-tree-label"><Folder size={15} />root</span>
      <small>{groupCount}</small>
      {onCreateGroup && (
        <TreeActionButton title="New stock group" ariaLabel="New stock group" onAction={onCreateGroup}>
          <Plus size={13} />
        </TreeActionButton>
      )}
    </div>
  );
}

function WatchGroupTitle({ tag, onSelect, onAddStockToGroup }: { tag: string; onSelect: () => void; onAddStockToGroup?: () => void }) {
  return (
    <div className="watch-tree-title watch-tree-group-title" onClick={onSelect}>
      <span className="watch-tree-label"><Folder size={15} />{tag}</span>
      {onAddStockToGroup && (
        <TreeActionButton title="Add symbol to group" ariaLabel="Add symbol to group" onAction={onAddStockToGroup}>
          <Plus size={13} />
        </TreeActionButton>
      )}
    </div>
  );
}

function WatchStockTitle({
  stock,
  selected,
  theme,
  onSelect,
  onOpenDetails
}: {
  stock: StockStatus;
  selected: boolean;
  theme: Theme;
  onSelect: () => void;
  onOpenDetails?: () => void;
}) {
  return (
    <div
      className={`watch-tree-stock ${selected ? "active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpenDetails}
    >
      <span className="stock-name">{displayName(stock)}</span>
      <SignedMetric value={stockPercent(stock)} digits={2} suffix="" theme={theme} />
    </div>
  );
}

function groupStocksByTag(stocks: StockStatus[], groupNames: string[], groupOrder: Record<string, string[]>) {
  const groups = new Map<string, StockStatus[]>();
  for (const tag of mergeWatchGroups(groupNames)) {
    groups.set(tag, []);
  }

  for (const stock of stocks) {
    const tags = stock.config.tags;
    for (const tag of tags) {
      const key = normalizeWatchGroupName(tag) || "watchlist";
      groups.set(key, [...(groups.get(key) ?? []), stock]);
    }
  }
  return [...groups.entries()]
    .map(([tag, groupStocks]) => {
      const positions = new Map((groupOrder[tag] ?? []).map((code, index) => [code.toLowerCase(), index]));
      const stocksWithIndex = groupStocks.map((stock, index) => ({ stock, index }));
      stocksWithIndex.sort((left, right) => {
        const leftPosition = positions.get(left.stock.config.code.toLowerCase());
        const rightPosition = positions.get(right.stock.config.code.toLowerCase());
        if (leftPosition === undefined && rightPosition === undefined) return left.index - right.index;
        if (leftPosition === undefined) return 1;
        if (rightPosition === undefined) return -1;
        return leftPosition - rightPosition;
      });
      return { tag, stocks: stocksWithIndex.map(({ stock }) => stock) };
    });
}

export function normalizeWatchGroupName(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

export function mergeWatchGroups(groups: string[]): string[] {
  const normalized = groups
    .map((group) => normalizeWatchGroupName(group))
    .filter(Boolean);
  return [...new Set(normalized)];
}

function watchSelectionKey(selection: WatchTreeSelection | undefined): string | undefined {
  if (!selection) return undefined;
  return selection.type === "group" ? watchGroupKey(selection.tag) : watchStockKey(selection.tag, selection.code);
}

function watchGroupKey(tag: string): string {
  return `watch-group:${encodeURIComponent(tag)}`;
}

function watchStockKey(sourceTag: string, code: string): string {
  return `watch-stock:${encodeURIComponent(sourceTag)}:${encodeURIComponent(code)}`;
}

function parseWatchGroupKey(key: string): string | undefined {
  if (!key.startsWith("watch-group:") || key.includes("::")) return undefined;
  return decodeURIComponent(key.slice("watch-group:".length));
}

function parseWatchStockKey(key: string): { sourceTag: string; code: string } | undefined {
  if (!key.startsWith("watch-stock:")) return undefined;
  const parts = key.split(":");
  if (parts.length !== 3) return undefined;
  return { sourceTag: decodeURIComponent(parts[1]), code: decodeURIComponent(parts[2]) };
}

function SignedMetric({
  value,
  digits,
  suffix = "",
  theme
}: {
  value: number | undefined;
  digits: number;
  suffix?: string;
  theme: Pick<Theme, "color_up" | "color_down">;
}) {
  if (value === undefined) return <span className="muted">--</span>;
  return <span style={{ color: profitColor(theme, value) }}>{formatSigned(value, digits)}{suffix}</span>;
}