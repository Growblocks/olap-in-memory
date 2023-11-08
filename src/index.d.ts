declare module '@growblocks/olap-in-memory' {
    type NestedNumberObject = {
        [key: string]: number | NestedNumberObject;
    };

    type NestedNumberArray = number[] | NestedNumberArray[];

    export class TimeDimension {
        id: string;
        constructor(name: string, granularity: string, start: string, end: string);
        getItems(attribute?: string | null): string[];
        union(other: TimeDimension): TimeDimension;
    }
    export class GenericDimension {
        id: string;
        constructor(name: string, attributes: string | string[], values: string[]);
        getItems(attribute?: string | null): string[];
        renameItem(item: string, newName: string, newLabel?: string): void;
        union(other: GenericDimension): GenericDimension;
    }
    export class Cube {
        constructor(dimensions: (TimeDimension | GenericDimension)[]);
        static deserialize(buffer: ArrayBuffer): Cube;
        static deserializeFromBase64String(base64Str: string): Cube;
        addDimension(
            dimension: GenericDimension | TimeDimension,
            aggregation?: Record<string, Record<string, string>>,
            index?: number,
            distributionObj?: Record<string, number[]>
        ): Cube;
        compose(cube: Cube, union: boolean): Cube;
        computedMeasureIds: string[];
        convertToStoredMeasure(
            measureId: string,
            opts?: Record<string, string>,
            measureType?: string,
            defaultValue?: number
        ): void;
        copyToStoredMeasure(
            computedMeasureId: string,
            storedMeasureId: string,
            opts?: Record<string, string>,
            measureType?: string,
            defaultValue?: number
        ): void;
        createComputedMeasure(name: string, valueStr: string): void;
        createStoredMeasure(
            name: string,
            opts?: Record<string, string>,
            measureType?: string,
            defaultValue?: number
        ): void;
        clone(): Cube;
        cloneStoredMeasure(originCube: Cube, measureId: string): void;
        computedMeasures: Object;
        copyMeasureData(
            sourceMeasureId: string,
            targetMeasureId: string,
            dimensionsFilter: Record<string, string | string[]>
        ): void;
        collapse(): Cube;
        dice(dimensionId: string, attribute: string, value: string[]): Cube;
        diceRange(dimensionId: string, attribute: string, start: string, end: string): Cube;
        dimensionIds: string[];
        drillDown(dimensionId: string, attribute: string, distributions?: number[]): Cube;
        drillUp(dimensionId: string, attribute: string, values?: string[]): Cube;
        dropMeasure(measure: string): void;
        getData(measure: string): number[];
        getDimension(dimensionId: string): GenericDimension | TimeDimension;
        getDistribution(measure: string, filter: Record<string, string[]>): number;
        getNestedArray(measure: string): NestedNumberArray;
        getNestedObject(measure: string): NestedNumberObject;
        getNestedObjects(measureIds: string[]): NestedNumberObject;
        getSingleData(measure: string, coords: Record<string, string>): number;
        scan(
            excludeDimensionIds: string[],
            cb: (dicedCube: Cube, dimensionItems: Record<string, string>) => void
        ): void;
        aggregateByDimensions(excludeDimensionIds: string[]): Cube;
        diceByDimensionItems(dimensions: Record<string, string | string[]>): Cube;
        getDimensionItemsMap(excludeDimensionIds?: string[]): Record<string, string[]>;
        iterateOverDimension(
            dimension: string,
            cb: (cube: Cube, dimensionItems: Record<string, string>) => void
        ): void;
        getTotal(measureId: string): number;
        getTotalForDimensionItems(
            measure: string,
            filter: Record<string, string[] | string>
        ): number;
        hydrateFromCube(cube: Cube): void;
        hydrateFromSparseNestedObject(measure: string, data: NestedNumberObject): void;
        keepDimensions(dimensionIds: string[]): Cube;
        removeDimension(dimensionId: string): Cube;
        removeDimensions(dimensionIds: string[]): Cube;
        renameMeasure(oldName: string, newName: string): void;
        reorderDimensions(dimensionIds: string[]): Cube;
        serialize(): ArrayBuffer;
        serializeToBase64String(): string;
        fillData(measure: string, data: number): void;
        setData(measure: string, data: number[]): void;
        setNestedArray(measure: string, data: NestedNumberArray): void;
        setNestedObject(measure: string, obj: NestedNumberObject): void;
        setSingleData(measure: string, coords: Record<string, string>, value: number): void;
        slice(dimensionId: string, attribute: string, value: string): Cube;
        storedMeasureIds: string[];
        storeSize: number;
        swapDimensions(dim1: string, dim2: string): Cube;
        updateStoredMeasureRules(
            measureId: string,
            cb: (rules: Record<string, string>) => Record<string, string>
        ): void;
    }
}
