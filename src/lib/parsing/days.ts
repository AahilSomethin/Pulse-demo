export function sortDayFiles(files: Iterable<File>): File[] {
  return [...files]
    .filter((file) => /\.csv$/i.test(file.name) && !file.name.startsWith("."))
    .sort((a, b) => {
      const left = Number(a.name.replace(/\.csv$/i, ""));
      const right = Number(b.name.replace(/\.csv$/i, ""));
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
      return a.name.localeCompare(b.name);
    });
}

export function dayTitle(fileName: string): string {
  const day = Number(fileName.replace(/\.csv$/i, ""));
  if (Number.isInteger(day) && day >= 1 && day <= 31) return `1–31 August file ${fileName}`;
  return fileName;
}
