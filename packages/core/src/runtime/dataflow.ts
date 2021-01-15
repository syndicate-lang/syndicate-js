//---------------------------------------------------------------------------
// @syndicate-lang/core, an implementation of Syndicate dataspaces for JS.
// Copyright (C) 2016-2021 Tony Garnock-Jones <tonyg@leastfixedpoint.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//---------------------------------------------------------------------------

// Property-based "dataflow"

import { FlexSet, FlexMap, Canonicalizer } from 'preserves';
import * as MapSet from './mapset.js';

export interface PropertyOptions<ObjectId> {
    objectId: ObjectId;
    noopGuard?: (oldValue: any, newValue: any) => boolean;
};

export class Graph<SubjectId, ObjectId> {
    readonly edgesForward: FlexMap<ObjectId, FlexSet<SubjectId>>;
    readonly edgesReverse: FlexMap<SubjectId, FlexSet<ObjectId>>;
    readonly subjectIdCanonicalizer: Canonicalizer<SubjectId>;
    readonly objectIdCanonicalizer: Canonicalizer<ObjectId>;
    damagedNodes: FlexSet<ObjectId>;
    currentSubjectId: SubjectId | undefined;

    constructor(subjectIdCanonicalizer: Canonicalizer<SubjectId>,
                objectIdCanonicalizer: Canonicalizer<ObjectId>)
    {
        this.edgesForward = new FlexMap(objectIdCanonicalizer);
        this.edgesReverse = new FlexMap(subjectIdCanonicalizer);
        this.subjectIdCanonicalizer = subjectIdCanonicalizer;
        this.objectIdCanonicalizer = objectIdCanonicalizer;
        this.damagedNodes = new FlexSet(objectIdCanonicalizer);
    }

    withSubject<T>(subjectId: SubjectId | undefined, f: () => T): T {
        let oldSubjectId = this.currentSubjectId;
        this.currentSubjectId = subjectId;
        let result: T;
        try {
            result = f();
        } catch (e) {
            this.currentSubjectId = oldSubjectId;
            throw e;
        }
        this.currentSubjectId = oldSubjectId;
        return result;
    }

    recordObservation(objectId: ObjectId) {
        if (this.currentSubjectId !== void 0) {
            MapSet.add(this.edgesForward, objectId, this.currentSubjectId, this.subjectIdCanonicalizer);
            MapSet.add(this.edgesReverse, this.currentSubjectId, objectId, this.objectIdCanonicalizer);
        }
    }

    recordDamage(objectId: ObjectId) {
        this.damagedNodes.add(objectId);
    }

    forgetSubject(subjectId: SubjectId) {
        const subjectObjects = this.edgesReverse.get(subjectId) ?? [] as Array<ObjectId>;
        this.edgesReverse.delete(subjectId);
        subjectObjects.forEach((oid: ObjectId) => MapSet.del(this.edgesForward, oid, subjectId));
    }

    repairDamage(repairNode: (subjectId: SubjectId) => void) {
        let repairedThisRound = new FlexSet(this.objectIdCanonicalizer);
        while (true) {
            let workSet = this.damagedNodes;
            this.damagedNodes = new FlexSet(this.objectIdCanonicalizer);

            const alreadyDamaged = workSet.intersect(repairedThisRound);
            if (alreadyDamaged.size > 0) {
                console.warn('Cyclic dependencies involving', alreadyDamaged);
            }

            workSet = workSet.subtract(repairedThisRound);
            repairedThisRound = repairedThisRound.union(workSet);

            if (workSet.size === 0) break;

            workSet.forEach(objectId => {
                const subjects = this.edgesForward.get(objectId) ?? [] as Array<SubjectId>;
                subjects.forEach((subjectId: SubjectId) => {
                    this.forgetSubject(subjectId);
                    this.withSubject(subjectId, () => repairNode(subjectId));
                });
            });
        }
    }

    defineObservableProperty<T, K extends keyof T>(
        obj: T,
        prop: K,
        value: T[K],
        options: PropertyOptions<ObjectId>)
    {
        const { objectId, noopGuard } = options;
        Object.defineProperty(obj, prop, {
            configurable: true,
            enumerable: true,
            get: () => {
                this.recordObservation(objectId);
                return value;
            },
            set: (newValue) => {
                if (!noopGuard || !noopGuard(value, newValue)) {
                    this.recordDamage(objectId);
                    value = newValue;
                }
            }
        });
        this.recordDamage(objectId);
        return objectId;
    }

    static newScope<T, R extends T>(o: T): R {
        const Scope: { new (): R, prototype: T } =
            (function Scope () {}) as unknown as ({ new (): R, prototype: T });
        Scope.prototype = o;
        return new Scope();
    }
}
