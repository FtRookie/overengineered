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
	private subscribed?: defined[]; // defined instead of T to workaround the type system
	private readonly inSelf = new Map<thread, number>();

	Connect(callback: (...args: TArgs) => void): SignalConnection {
		if (this.destroyed) return { Disconnect() {} };

		this.subscribed ??= [];
		this.subscribed.push(callback);

		const arr = this.subscribed;
		return {
			Disconnect() {
				arr.remove(arr.indexOf(callback));
			},
		};
	}
	Fire(...args: TArgs): void {
		if (!this.subscribed) return;

		const thread = coroutine.running();
		const inSelf = this.inSelf.get(thread) ?? 0;

		if (inSelf > 10) {
			warn(`Signal self-calling overflow: ${debug.traceback()}`);
			throw "Signal self-calling overflow.";
		}

		this.inSelf.set(thread, inSelf + 1);
		for (const sub of this.subscribed) {
			const [success, result] = xpcall(
				sub as (...args: TArgs) => void,
				(err) => {
					warn(
						`Exception in signal ${tostring(this).sub("table: ".size() + 1)} handling ${tostring(sub).sub("function: ".size() + 1)}:\n${err}`,
						`\nat`,
						debug.traceback(undefined, 2),
					);

					return err;
				},
				...args,
			);

			if (!success) {
				this.inSelf.delete(thread);
				error(result, 2);
			}
		}

		this.inSelf.delete(thread);
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
