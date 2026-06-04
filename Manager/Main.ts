import {
	ConVarsSDK,
	Creep,
	CreepPathCorner,
	DotaMap,
	Entity,
	EntityManager,
	Hero,
	LocalPlayer,
	Tower,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./Menu"

interface LastHitDecision {
	readonly target: Creep
	readonly shouldAttack: boolean
}

const CREEP_DISTANCE_TOLERANCE = 80
const HOLD_POSITION_DISTANCE = 90
const LAST_HIT_ATTACK_RANGE_BUFFER = 50
const LAST_HIT_PREPARE_TIME = 0.85
const LAST_HIT_SEARCH_RANGE = 1600
const LANE_CREEP_DAMAGE_PER_SECOND = 45

export class MainManager {
	protected MyHero: Nullable<Hero>
	protected LastX = 0
	protected LastY = 0
	protected StuckTime = 0

	constructor(protected readonly menu: MenuManager) {}

	public OnTick(dt: number): void {
		if (!this.menu.State) {
			return
		}

		const hero = this.MyHero ?? LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive || !hero.IsSpawned) {
			return
		}

		this.MyHero = hero
		this.ProcessAutoPush(hero)

		const dx = Math.abs(hero.Position.x - this.LastX)
		const dy = Math.abs(hero.Position.y - this.LastY)
		if (hero.IsMoving && dx < 1 && dy < 1) {
			this.StuckTime += dt
		} else {
			this.LastX = hero.Position.x
			this.LastY = hero.Position.y
			this.StuckTime = 0
		}

		if (this.StuckTime > 30) {
			this.StuckTime = 0
			this.NudgeSafe(hero, EntityManager.GetEntitiesByClass(Tower))
		}
	}

	public OnDraw(): void {
		if (!this.menu.State) {
			return
		}

		const hero = this.MyHero ?? LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive || !hero.IsSpawned) {
			return
		}

		this.MyHero = hero
		this.LockCamera(hero)
	}

	public OnGameEnded(): void {
		this.MyHero = undefined
	}

	public OnGameStarted(): void {
		this.MyHero = LocalPlayer?.Hero
		this.StuckTime = 0
	}

	public OnEntityCreated(entity: Entity): void {
		if (entity instanceof Hero && entity.IsMyHero) {
			this.MyHero = entity
		}
	}

	public OnEntityDestroyed(entity: Entity): void {
		if (this.MyHero === entity) {
			this.MyHero = undefined
		}
	}

	protected LockCamera(_hero: Hero): void {
		ConVarsSDK.Set("dota_camera_lock", 1)
	}

	protected ProcessAutoPush(hero: Hero): void {
		const lane = this.menu.Lane
		const laneCreeps = this.GetLaneCreeps(
			EntityManager.GetEntitiesByClass(Creep),
			lane
		)

		const nearestEnemy = this.GetNearestEnemyHero(
			hero,
			EntityManager.GetEntitiesByClass(Hero)
		)
		if (
			nearestEnemy !== undefined &&
			nearestEnemy.Distance2D(hero) < this.menu.EnemyDistance
		) {
			this.RetreatFrom(hero, nearestEnemy.Position)
			return
		}

		const towers = EntityManager.GetEntitiesByClass(Tower)
		if (this.IsInTowerRange(hero, towers)) {
			this.MoveToSafePosition(
				hero,
				DotaMap.GetCreepCurrentTarget(hero.Position, hero.Team, lane),
				towers
			)
			return
		}

		const lastHit = this.FindLastHitTarget(hero, laneCreeps)
		if (lastHit !== undefined && this.HandleLastHit(hero, lastHit)) {
			return
		}

		if (laneCreeps.length === 0) {
			this.IdleNearTower(hero, towers)
			return
		}

		this.PositionNearCreeps(hero, laneCreeps, lane)
	}

	protected GetLaneCreeps(creeps: Creep[], lane: number): Creep[] {
		const result: Creep[] = []
		for (let i = 0; i < creeps.length; i++) {
			const creep = creeps[i]
			if (creep.IsSpawned && creep.IsAlive && creep.Lane === lane) {
				result.push(creep)
			}
		}
		return result
	}

	protected FindLastHitTarget(
		hero: Hero,
		laneCreeps: Creep[]
	): Nullable<LastHitDecision> {
		let bestTarget: Nullable<Creep>
		let bestShouldAttack = false
		let bestScore = Infinity

		for (let i = 0; i < laneCreeps.length; i++) {
			const creep = laneCreeps[i]
			if (!this.IsValidLastHitTarget(hero, creep)) {
				continue
			}

			const damage = hero.GetAttackDamage(creep)
			if (damage <= 0) {
				continue
			}

			const distance = hero.Distance2D(creep)
			if (distance > LAST_HIT_SEARCH_RANGE) {
				continue
			}

			const attackRange = hero.GetAttackRange(creep)
			const timeToImpact = this.GetAttackImpactTime(hero, creep, attackRange)
			const predictedHP = this.GetPredictedCreepHP(creep, timeToImpact)
			if (predictedHP <= 0) {
				continue
			}

			const shouldAttack = damage >= predictedHP && hero.CanAttack(creep)
			const prepareHP = this.GetPredictedCreepHP(
				creep,
				timeToImpact + LAST_HIT_PREPARE_TIME
			)
			const desiredRange = Math.max(
				attackRange - LAST_HIT_ATTACK_RANGE_BUFFER,
				80
			)
			const shouldPrepare =
				damage >= prepareHP && distance > desiredRange + HOLD_POSITION_DISTANCE
			if (!shouldAttack && !shouldPrepare) {
				continue
			}

			const score = shouldAttack
				? predictedHP
				: prepareHP + distance / Math.max(hero.MoveSpeed, 1)
			if (score < bestScore || (shouldAttack && !bestShouldAttack)) {
				bestScore = score
				bestShouldAttack = shouldAttack
				bestTarget = creep
			}
		}

		if (bestTarget === undefined) {
			return undefined
		}
		return {
			target: bestTarget,
			shouldAttack: bestShouldAttack
		}
	}

	protected IsValidLastHitTarget(hero: Hero, creep: Creep): boolean {
		if (
			!creep.IsEnemy(hero) ||
			!creep.IsAlive ||
			!creep.IsSpawned ||
			!creep.IsVisible
		) {
			return false
		}
		if (creep.IsInvulnerable || creep.IsUntargetable) {
			return false
		}
		if (hero.IsDisarmed || hero.IsAttackImpaired) {
			return false
		}
		return hero.CanHitAttackImmune(creep)
	}

	protected GetAttackImpactTime(hero: Hero, creep: Creep, attackRange: number): number {
		const distance = hero.Distance2D(creep)
		const desiredRange = Math.max(attackRange - LAST_HIT_ATTACK_RANGE_BUFFER, 80)
		const moveTime =
			Math.max(distance - desiredRange, 0) / Math.max(hero.MoveSpeed, 1)
		const projectileSpeed = Math.max(hero.AttackProjectileSpeed, 1)
		const projectileTime = hero.IsRanged ? distance / projectileSpeed : 0
		return moveTime + hero.AttackPoint + projectileTime
	}

	protected GetPredictedCreepHP(creep: Creep, delay: number): number {
		return creep.HP - LANE_CREEP_DAMAGE_PER_SECOND * Math.max(delay, 0)
	}

	protected HandleLastHit(hero: Hero, decision: LastHitDecision): boolean {
		const target = decision.target
		const attackRange = hero.GetAttackRange(target)
		const distance = hero.Distance2D(target)

		if (decision.shouldAttack && distance <= attackRange && hero.CanAttack(target)) {
			hero.AttackTarget(target)
			return true
		}

		const desiredRange = Math.max(attackRange - LAST_HIT_ATTACK_RANGE_BUFFER, 80)
		if (distance > desiredRange) {
			hero.MoveTo(this.GetPointAtDistanceFromTarget(hero, target, desiredRange))
			return true
		}

		return false
	}

	protected GetNearestEnemyHero(hero: Hero, heroes: Hero[]): Nullable<Hero> {
		let nearest: Nullable<Hero>
		let minDist = Infinity

		for (let i = 0; i < heroes.length; i++) {
			const enemy = heroes[i]
			if (
				enemy === hero ||
				!enemy.IsEnemy(hero) ||
				!enemy.IsAlive ||
				!enemy.IsSpawned
			) {
				continue
			}

			const dist = enemy.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearest = enemy
			}
		}
		return nearest
	}

	protected RetreatFrom(hero: Hero, threatPosition: Vector3): void {
		const direction = hero.Position
			.Clone()
			.SubtractForThis(threatPosition)
			.SetZ(0)
			.Normalize()
			.MultiplyScalarForThis(400)

		hero.MoveTo(hero.Position.Clone().AddForThis(direction))
	}

	protected IsInTowerRange(hero: Hero, towers: Tower[]): boolean {
		for (let i = 0; i < towers.length; i++) {
			const tower = towers[i]
			if (!tower.IsAlive || !tower.IsSpawned || !tower.IsEnemy(hero)) {
				continue
			}

			if (tower.Distance2D(hero) <= tower.GetAttackRange(hero, 100)) {
				return true
			}
		}
		return false
	}

	protected MoveToSafePosition(
		hero: Hero,
		nextCorner: Nullable<CreepPathCorner>,
		towers: Tower[]
	): void {
		if (nextCorner !== undefined && nextCorner.Referencing.size > 0) {
			const previousCorners = [...nextCorner.Referencing]
			hero.MoveTo(previousCorners[0].Position)
			return
		}

		let nearestBuilding: Nullable<Tower>
		let minDist = Infinity
		for (let i = 0; i < towers.length; i++) {
			const tower = towers[i]
			if (tower.IsEnemy(hero) || !tower.IsAlive || !tower.IsSpawned) {
				continue
			}

			const dist = tower.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearestBuilding = tower
			}
		}

		if (nearestBuilding !== undefined) {
			hero.MoveTo(nearestBuilding.Position)
		}
	}

	protected IdleNearTower(hero: Hero, towers: Tower[]): void {
		let nearestFriendly: Nullable<Tower>
		let minDist = Infinity
		for (let i = 0; i < towers.length; i++) {
			const tower = towers[i]
			if (tower.IsEnemy(hero) || !tower.IsAlive || !tower.IsSpawned) {
				continue
			}
			const dist = tower.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearestFriendly = tower
			}
		}

		if (nearestFriendly === undefined || minDist < 400) {
			return
		}

		hero.MoveTo(nearestFriendly.Position)
	}

	protected PositionNearCreeps(
		hero: Hero,
		laneCreeps: Creep[],
		lane: number
	): void {
		const targetDist = this.menu.CreepDistance
		let nearestFriendly: Nullable<Creep>
		let minDist = Infinity

		for (let i = 0; i < laneCreeps.length; i++) {
			const creep = laneCreeps[i]
			if (creep.IsEnemy(hero)) {
				continue
			}

			const dist = creep.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearestFriendly = creep
			}
		}

		if (nearestFriendly === undefined) {
			return
		}

		const holdPosition = this.GetCreepHoldPosition(
			hero,
			nearestFriendly,
			lane,
			targetDist
		)
		const holdDistance = hero.Distance2D(holdPosition)

		if (
			Math.abs(minDist - targetDist) <= CREEP_DISTANCE_TOLERANCE ||
			holdDistance <= HOLD_POSITION_DISTANCE
		) {
			hero.HoldPosition(hero.Position)
			return
		}

		hero.MoveTo(holdPosition)
	}

	protected GetCreepHoldPosition(
		hero: Hero,
		creep: Creep,
		lane: number,
		distance: number
	): Vector3 {
		const laneDirection = this.GetLaneDirection(hero, creep, lane)
		if (!laneDirection.IsZero()) {
			return creep.Position
				.Clone()
				.SubtractForThis(laneDirection.MultiplyScalar(distance))
		}
		return this.GetPointAtDistanceFromTarget(hero, creep, distance)
	}

	protected GetLaneDirection(hero: Hero, creep: Creep, lane: number): Vector3 {
		const nextCorner = DotaMap.GetCreepCurrentTarget(creep.Position, hero.Team, lane)
		if (nextCorner === undefined) {
			return creep.Forward.Clone().SetZ(0).Normalize()
		}
		return nextCorner.Position.Clone().SubtractForThis(creep.Position).SetZ(0).Normalize()
	}

	protected GetPointAtDistanceFromTarget(
		hero: Hero,
		target: Entity,
		distance: number
	): Vector3 {
		const direction = hero.Position
			.Clone()
			.SubtractForThis(target.Position)
			.SetZ(0)
			.Normalize()
		if (direction.IsZero()) {
			return hero.Position
		}
		return target.Position.Clone().AddForThis(direction.MultiplyScalar(distance))
	}

	protected NudgeSafe(hero: Hero, towers: Tower[]): void {
		let nearestFriendly: Nullable<Tower>
		let minDist = Infinity
		for (let i = 0; i < towers.length; i++) {
			const tower = towers[i]
			if (tower.IsEnemy(hero) || !tower.IsAlive || !tower.IsSpawned) {
				continue
			}
			const dist = tower.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearestFriendly = tower
			}
		}

		if (nearestFriendly !== undefined) {
			const dir = nearestFriendly.Position
				.Clone()
				.SubtractForThis(hero.Position)
				.SetZ(0)
				.Normalize()
				.MultiplyScalarForThis(300)

			hero.MoveTo(hero.Position.Clone().AddForThis(dir))
		}
	}
}
