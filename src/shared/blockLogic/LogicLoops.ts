import { BlockBackedInputLogicValueStorage } from "shared/blockLogic/BlockLogicValueStorage";
import type { GenericBlockLogic } from "shared/blockLogic/BlockLogic";
import type { BlockLogicTypes } from "shared/blockLogic/BlockLogicTypes";

type Node = GenericBlockLogic;
type Wire = BlockBackedInputLogicValueStorage<keyof BlockLogicTypes.Primitives>;

export namespace LogicLoops {
	export type Entry = {
		readonly uuid: BlockUuid;
		readonly id: BlockId;
		readonly logic: Node;
	};

	type Frame = { readonly node: Node; readonly targets: readonly Node[]; i: number };
	function stronglyConnected(nodes: readonly Node[], successorsOf: (node: Node) => readonly Node[]): Node[][] {
		const index = new Map<Node, number>();
		const low = new Map<Node, number>();
		const onStack = new Set<Node>();
		const stack: Node[] = [];
		const result: Node[][] = [];
		let counter = 0;

		const enter = (node: Node, work: Frame[]) => {
			index.set(node, counter);
			low.set(node, counter);
			counter++;
			stack.push(node);
			onStack.add(node);
			work.push({ node, targets: successorsOf(node), i: 0 });
		};

		for (const root of nodes) {
			if (index.has(root)) continue;

			const work: Frame[] = [];
			enter(root, work);
			while (!work.isEmpty()) {
				const frame = work[work.size() - 1];
				if (frame.i < frame.targets.size()) {
					const target = frame.targets[frame.i++];
					if (!index.has(target)) {
						enter(target, work);
					} else if (onStack.has(target)) {
						low.set(frame.node, math.min(low.get(frame.node)!, index.get(target)!));
					}
					continue;
				}

				work.pop();
				if (!work.isEmpty()) {
					const parent = work[work.size() - 1].node;
					low.set(parent, math.min(low.get(parent)!, low.get(frame.node)!));
				}
				if (low.get(frame.node) !== index.get(frame.node)) continue;

				const component: Node[] = [];
				while (true as boolean) {
					const member = stack.pop()!;
					onStack.delete(member);
					component.push(member);
					if (member === frame.node) break;
				}
				if (component.size() > 1 || frame.targets.includes(frame.node)) {
					result.push(component);
				}
			}
		}

		return result;
	}

	export function cutLoops(entries: readonly Entry[]): readonly Node[] {
		const entryOf = new Map<Node, Entry>();
		for (const entry of entries) {
			entryOf.set(entry.logic, entry);
		}

		const readers = new Map<Node, Node[]>();
		const wiresInto = new Map<Node, Wire[]>();
		for (const entry of entries) {
			const wires: Wire[] = [];
			for (const [, storage] of pairs(entry.logic.input)) {
				if (!(storage instanceof BlockBackedInputLogicValueStorage)) continue;
				if (!entryOf.has(storage.outputBlock)) continue;

				wires.push(storage as Wire);
				readers.getOrSet(storage.outputBlock, () => []).push(entry.logic);
			}
			wiresInto.set(entry.logic, wires);
		}

		const byUuid = (a: Node, b: Node) => entryOf.get(a)!.uuid < entryOf.get(b)!.uuid;
		const allRegisters: Node[] = [];
		const nodes = entries.map((e) => e.logic);
		for (const loop of stronglyConnected(nodes, (node) => readers.get(node) ?? [])) {
			loop.sort(byUuid);
			const members = new Set(loop);
			const registers = new Set(loop.filter((node) => node.definition.stateful === true));

			while (true as boolean) {
				const uncut = stronglyConnected(loop, (node) =>
					registers.has(node) ? [] : (readers.get(node) ?? []).filter((r) => members.has(r)),
				);
				if (uncut.isEmpty()) break;

				for (const remaining of uncut) {
					remaining.sort(byUuid);
					registers.add(remaining.find((node) => entryOf.get(node)!.id === "fallback") ?? remaining[0]);
				}
			}

			for (const node of loop) {
				for (const wire of wiresInto.get(node)!) {
					if (registers.has(wire.outputBlock)) wire.readStartOfTick();
				}
			}
			for (const node of loop) {
				if (registers.has(node)) allRegisters.push(node);
			}
		}

		return allRegisters;
	}
}
