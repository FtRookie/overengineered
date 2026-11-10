declare global {
	interface SignalConnection {
		Disconnect(): void;
	}

	interface ReadonlyArgsSignal<TArgs extends unknown[] = []> {
		Connect(callback: (...args: TArgs) => void): SignalConnection;
	}
	interface ReadonlySignal<T extends (...args: any[]) => void = () => void> extends ReadonlyArgsSignal<
		Parameters<T>
	> {}
}

export interface ReadonlyArgsSignal<TArgs extends unknown[]> {
	Connect(callback: (...args: TArgs) => void): SignalConnection;
}
export interface ReadonlySignal<T extends (...args: any[]) => void = () => void> extends ReadonlyArgsSignal<
	Parameters<T>
> {}

/** A signal that you can subscribe to, unsibscribe from and fire */
export class ArgsSignal<TArgs extends unknown[] = []> implements ReadonlyArgsSignal<TArgs> {
	static connection(func: () => void): SignalConnection {
		return {
			Disconnect() {
				func();
			},
		};
	}
	static connectionFromTask(thread: thread): SignalConnection {
		return this.connection(() => {
			try {
				task.cancel(thread);
			} catch {
				// empty
			}
		});
	}
	static multiConnection(...connections: SignalConnection[]): SignalConnection {
		return {
			Disconnect() {
				for (const connection of connections) {
					connection.Disconnect();
				}
			},
		};
	}

	private destroyed = false;
	private subscribed?: { readonly callback: defined; dead?: boolean }[]; // defined instead of T to workaround the type system
	private readonly inSelf = new Map<thread, number>();
	private errorHandler?: (err: unknown) => unknown;
	private firingSub?: defined;
	private firing = 0;
	private hasDead = false;

	Connect(callback: (...args: TArgs) => void): SignalConnection {
		if (this.destroyed) return { Disconnect() {} };

		this.subscribed ??= [];
		const entry: { readonly callback: defined; dead?: boolean } = { callback };
		this.subscribed.push(entry);

		const arr = this.subscribed;
		const signal = this;
		return {
			Disconnect() {
				if (entry.dead) return;
				entry.dead = true;

				if (signal.firing > 0) {
					signal.hasDead = true;
					return;
				}

				const index = arr.indexOf(entry);
				if (index !== -1) arr.remove(index);
			},
		};
	}
	private finishFiring(subs: { readonly callback: defined; dead?: boolean }[]) {
		this.firing--;
		if (this.firing > 0 || !this.hasDead) return;

		this.hasDead = false;
		let kept = 0;
		for (let i = 0; i < subs.size(); i++) {
			const sub = subs[i];
			if (sub.dead) continue;
			subs[kept++] = sub;
		}
		while (subs.size() > kept) subs.pop();
	}
	Fire(...args: TArgs): void {
		if (!this.subscribed || this.subscribed.size() === 0) return;

		const thread = coroutine.running();
		const inSelf = this.inSelf.get(thread) ?? 0;

		if (inSelf > 10) {
			warn(`Signal self-calling overflow: ${debug.traceback()}`);
			throw "Signal self-calling overflow.";
		}

		this.inSelf.set(thread, inSelf + 1);
		// one handler per signal instead of one per subscriber per fire; firingSub carries the name into it
		this.errorHandler ??= (err) => {
			warn(
				`Exception in signal ${tostring(this).sub("table: ".size() + 1)} handling ${tostring(this.firingSub).sub("function: ".size() + 1)}:\n${err}`,
				`\nat`,
				debug.traceback(undefined, 2),
			);

			return err;
		};

		const subs = this.subscribed;
		this.firing++;
		const count = subs.size();
		let i = 0;
		while (i < count) {
			const sub = subs[i++];
			if (sub.dead) continue;

			this.firingSub = sub.callback;
			const [success, result] = xpcall(sub.callback as (...args: TArgs) => void, this.errorHandler, ...args);

			if (!success) {
				this.inSelf.delete(thread);
				this.finishFiring(subs);
				error(result, 2);
			}
		}

		this.firingSub = undefined;
		this.inSelf.delete(thread);
		this.finishFiring(subs);
	}

	destroy() {
		this.destroyed = true;
		this.subscribed = undefined;
	}

	asReadonly(): ReadonlyArgsSignal<TArgs> {
		return this;
	}
}

/** A signal that you can subscribe to, unsibscribe from and fire */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Signal<T extends (...args: any) => void = () => void> extends ArgsSignal<Parameters<T>> {}
