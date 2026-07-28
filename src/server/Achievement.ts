import { Component } from "engine/shared/component/Component";
import { Objects } from "engine/shared/fixes/Objects";
import { CustomRemotes } from "shared/Remotes";
import type { AchievementData } from "shared/AchievementData";

export type BaseAchievementStats = {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly imageID?: string;
	readonly hidden?: boolean;

	/** If set, signifies a maximum value for `progress` and enables a progress bar */
	readonly max?: number;

	/** Visual units:
	 * `undefined` (default): Converts to shorthand (1234 into 1.23K)
	 * `time`: Converts to short time (3600 to 1 hour)
	 * `precise`: Doesn't change the number
	 */
	readonly units?: "time" | "precise";
};

export abstract class Achievement<Z = {}, T extends Z & AchievementData = Z & AchievementData> extends Component {
	private data?: T;

	constructor(
		private readonly player: Player,
		readonly info: BaseAchievementStats,
	) {
		super();
	}

	/** @deprecated @hidden Internal usage only */
	setData(data: T | undefined) {
		this.data = data;

		if (data?.completed) {
			this.disable();
		}
	}

	private remotechanged = false;
	getChangesForRemote(): T | undefined {
		if (!this.remotechanged) return;
		this.remotechanged = false;

		return this.data;
	}

	private dbchanged = false;
	getChangesForDatabase(): T | undefined {
		if (!this.dbchanged) return;
		this.dbchanged = false;

		return this.data;
	}

	getData(): T | undefined {
		return this.data;
	}

	set(data: T) {
		if (this.getData()?.completed) return;
		if (Objects.deepEquals(data, this.data)) {
			return;
		}

		this.forceSet(data);
	}

	/** @hidden @deprecated */
	forceSet(data: T) {
		if (this.info.max && data.progress && data.progress >= this.info.max) {
			(data as Writable<T>).completed = true;
		}

		if (data.completed) {
			(data as Writable<T>).completionDateUnix = DateTime.now().UnixTimestamp;
		}
		this.data = data;
		this.dbchanged = this.remotechanged = true;

		// send update immediately if completed
		if (data.completed) {
			CustomRemotes.achievements.update.send(this.player, { [this.info.id]: data });
			this.remotechanged = false;
			this.disable();
		}
	}
}
