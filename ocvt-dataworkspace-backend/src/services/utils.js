const JSZip = require("jszip");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const shapefile = require("shapefile");

// Fonctions utilitaires
const streamToBuffer = (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
};

const flattenXml = (xmlData) => {
  return Object.values(xmlData)[0];
};

async function handleZippedShapefile(fileData) {
  // Créer un dossier temporaire pour extraire les fichiers
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "shapefile-"));

  try {
    // Décompresser le zip
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(fileData);

    // Trouver les fichiers .shp et .dbf
    let shpFile = null;
    let dbfFile = null;

    for (const filename in zipContent.files) {
      if (filename.endsWith(".shp")) {
        const content = await zipContent.files[filename].async("nodebuffer");
        const filePath = path.join(tempDir, filename);
        await fs.writeFile(filePath, content);
        shpFile = filePath;
      }
      if (filename.endsWith(".dbf")) {
        const content = await zipContent.files[filename].async("nodebuffer");
        const filePath = path.join(tempDir, filename);
        await fs.writeFile(filePath, content);
        dbfFile = filePath;
      }
    }

    if (!shpFile) {
      throw new Error("Aucun fichier .shp trouvé dans l'archive zip");
    }

    // Ouvrir et lire le shapefile
    const source = await shapefile.open(shpFile, dbfFile);
    const collection = { type: "FeatureCollection", features: [] };
    let result;
    while ((result = await source.read()) && !result.done) {
      collection.features.push(result.value);
    }

    return collection.features;
  } finally {
    // Nettoyer le dossier temporaire
    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        await fs.unlink(path.join(tempDir, file));
      }
      await fs.rmdir(tempDir);
    } catch (cleanupError) {
      // console.error(
      //   "Erreur lors du nettoyage des fichiers temporaires:",
      //   cleanupError
      // );
    }
  }
}

const mimeTypeMap = {
  json: ["application/json"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  svg: ["image/svg+xml"],
  geojson: ["application/geo+json", "application/json"],
  shapefile: ["application/zip", "application/octet-stream"], // ZIP ou fichiers binaires
};

// Valider le MIME type
const validateMimeType = (mimeType, expectedFormat) => {
  const allowedMimeTypes = mimeTypeMap[expectedFormat] || [];
  return allowedMimeTypes.some((allowed) =>
    mimeType.includes(allowed.split("/")[1])
  );
};

module.exports = {
  streamToBuffer,
  flattenXml,
  handleZippedShapefile,
  validateMimeType,
};
