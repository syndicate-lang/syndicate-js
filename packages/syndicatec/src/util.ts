export function dataURL(s: string): string {
    return `data:application/json;base64,${Buffer.from(s).toString('base64')}`;
}

export function sourceMappingComment(url: string): string {
    return `\n//# sourceMappingURL=${url}`;
}
