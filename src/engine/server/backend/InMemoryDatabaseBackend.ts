import { formatDatabaseBackendKeys } from "engine/server/backend/DatabaseBackend";
import type { DatabaseBackend } from "engine/server/backend/DatabaseBackend";

export class InMemoryDatabaseBackend<T> implements DatabaseBackend<T, defined[]> {
	private readonly data = new Map<string, T>();

	constructor(private readonly defaultValue?: () => T | undefined) {}

	GetAsync(args: readonly defined[]): T | undefined {
		let ret = this.data.get(formatDatabaseBackendKeys(args));
		if (!ret) {
			ret = this.defaultValue?.();
			if (ret) {
				this.SetAsync(ret, args);
			}
		}

		return ret;
	}
	SetAsync(value: T, args: readonly defined[]): void {
		this.data.set(formatDatabaseBackendKeys(args), value);
	}
	RemoveAsync(args: readonly defined[]): void {
		this.data.delete(formatDatabaseBackendKeys(args));
	}
}
