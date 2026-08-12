import { MarketplaceService, Players, RunService } from "@rbxts/services";
import { HostedService } from "engine/shared/di/HostedService";
import { ArgsSignal } from "engine/shared/event/Signal";
import { CustomRemotes } from "shared/Remotes";

export namespace Donations {
	export const rungs = [0, 5, 10, 25, 50, 100, 250, 500, 1000] as const;
	export type Amount = `${(typeof rungs)[number]}`;

	/** Donate presses that earn the achievement without paying, so it is not gated behind Robux. */
	export const freeClicks = 100;

	export const products: { readonly [k in Amount]: number } = {
		"0": 0,
		"5": 3678755063,
		"10": 3678762070,
		"25": 3678771885,
		"50": 3678798127,
		"100": 3678803151,
		"250": 3678836032,
		"500": 3678887484,
		"1000": 3678896175,
	};

	export function robuxOf(productId: number): number {
		if (productId === 0) return 0;

		for (const [amount, id] of pairs(products)) {
			if (id === productId) return tonumber(amount) ?? 0;
		}
		return 0;
	}
	export function isDonation(productId: number): boolean {
		return robuxOf(productId) > 0;
	}
}

/**
 * Server-only: the receipt is the only place a donation is observable, since the client-side prompt event
 * does not fire. It lives here rather than under `server/` because the rungs above are read by the GUI too.
 */
@injectable
export class DonationController extends HostedService {
	private readonly _donated = new ArgsSignal<[player: Player, robux: number]>();
	readonly donated = this._donated.asReadonly();

	constructor() {
		super();
		if (!RunService.IsServer()) return;

		// fixme: ProcessReceipt is one per server, so any future product has to be handled here too —
		// NotProcessedYet makes Roblox retry the receipt forever rather than dropping it
		MarketplaceService.ProcessReceipt = (receipt) => {
			if (!Donations.isDonation(receipt.ProductId)) {
				return Enum.ProductPurchaseDecision.NotProcessedYet;
			}

			const player = Players.GetPlayerByUserId(receipt.PlayerId);
			if (!player) return Enum.ProductPurchaseDecision.NotProcessedYet;

			this._donated.Fire(player, receipt.CurrencySpent);
			// only the donor is notified — the amount is theirs, not broadcast to others
			CustomRemotes.donated.send(player, receipt.CurrencySpent);
			return Enum.ProductPurchaseDecision.PurchaseGranted;
		};
	}
}
