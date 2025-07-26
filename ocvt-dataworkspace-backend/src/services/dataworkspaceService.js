const {
  FinalResults,
  NonFinalSources,
  ProcessingStates,
  Submissions,
  SourceTypes,
  SupportedFileExtensions,
  SupportedDatabaseTypes,
  SupportedCharts,
} = require("../models");
const minioClient = require("../config/minioClient");
const Papa = require("papaparse");
const XLSX = require("xlsx");
const xml2js = require("xml2js");
const shapefile = require("shapefile");
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const {
  streamToBuffer,
  flattenXml,
  handleZippedShapefile,
} = require("./utils");

// Fonction utilitaire pour générer un timestamp formaté
const generateTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error(
    "ENCRYPTION_KEY doit être une chaîne hexadécimale de 32 bytes"
  );
}

// Chiffrer un texte
const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    iv: iv.toString("hex"),
    encrypted: encrypted,
  };
};

// Déchiffrer un texte
const decrypt = (encryptedData) => {
  const iv = Buffer.from(encryptedData.iv, "hex");
  const encrypted = Buffer.from(encryptedData.encrypted, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};
// Fonction utilitaire pour valider les noms de table/colonne
const isValidDbIdentifier = (name) => {
  // Permet les lettres, chiffres et underscores. Empêche les caractères spéciaux qui pourraient être utilisés pour l'injection.
  return /^[a-zA-Z0-9_]+$/.test(name);
};

const BUCKET_NAME = process.env.MINIO_BUCKET;

// Lister les sources de données de l'utilisateur (nouvelle version)
const listDataSources = async (userId) => {
  // Récupérer les sources finales
  const finalResults = await FinalResults.findAll({
    where: { user_id: userId },
    attributes: [
      "final_result_id",
      ["result_type", "source_type"],
      ["result_name", "source_name"],
      "metadata",
      "created_at",
      "updated_at",
    ],
  });

  // Récupérer les sources non-finales
  const nonFinalSources = await NonFinalSources.findAll({
    where: { user_id: userId },
    attributes: [
      "non_final_source_id",
      "source_type",
      "source_name",
      "metadata",
      "created_at",
      "updated_at",
    ],
    include: [
      {
        model: ProcessingStates,
        as: "ProcessingStates",
        where: { is_current: true },
        required: false,
        attributes: [
          "state_id",
          "version",
          "file_path",
          "file_format",
          "transformation_type",
          "transformation_parameters",
          "created_at",
          "updated_at",
        ],
      },
    ],
  });

  // Formater la réponse pour regrouper les deux types
  const formattedFinals = finalResults.map((f) => ({
    type: "final",
    id: f.final_result_id,
    source_type: f.get("source_type"),
    source_name: f.get("source_name"),
    metadata: f.metadata,
    created_at: f.created_at,
    updated_at: f.updated_at,
  }));
  const formattedNonFinals = nonFinalSources.map((nf) => ({
    type: "non_final",
    id: nf.non_final_source_id,
    source_type: nf.source_type,
    source_name: nf.source_name,
    metadata: nf.metadata,
    created_at: nf.created_at,
    updated_at: nf.updated_at,
    current_state:
      nf.ProcessingStates && nf.ProcessingStates.length > 0
        ? nf.ProcessingStates[0]
        : null,
  }));

  const allSources = [...formattedFinals, ...formattedNonFinals];
  if (allSources.length === 0) {
    throw new Error("Aucune source de données trouvée pour cet utilisateur");
  }
  return { success: true, data: allSources };
};

// Lister les types de sources de données actifs
const listDataSourceTypes = async () => {
  const sourceTypes = await SourceTypes.findAll({
    where: { status: "active" },
    attributes: ["type_name"],
  });
  return {
    success: true,
    data: sourceTypes.map((type) => type.type_name),
    message: "Types de sources récupérés avec succès",
  };
};

// Activer ou désactiver un type de source
const updateSourceTypeStatus = async (sourceTypeId, status) => {
  const validStatuses = ["active", "inactive"];
  if (!validStatuses.includes(status)) {
    throw new Error("Statut invalide. Valeurs acceptées : active, inactive");
  }

  const sourceType = await SourceTypes.findOne({
    where: { source_type_id: sourceTypeId },
  });
  if (!sourceType) {
    throw new Error("Type de source non trouvé");
  }

  await sourceType.update({ status });

  return {
    success: true,
    source_type_id: sourceType.source_type_id,
    type_name: sourceType.type_name,
    status,
    message: "Statut du type de source mis à jour",
  };
};

// Ajouter une nouvelle source de données
const addDataSource = async (
  userId,
  sourceType,
  sourceName,
  file,
  metadata,
  isFinal = false
) => {
  const validSourceTypes = ["file", "database", "api"];
  if (!validSourceTypes.includes(sourceType)) {
    throw new Error(
      "Type de source invalide. Valeurs acceptées : file, database, api"
    );
  }
  if (!sourceName || sourceName.trim() === "") {
    throw new Error("La description de la source est requise");
  }

  let filePath;
  let fileFormat;
  let metadataToStore = metadata || {};

  if (isFinal) {
    // --- Cas source finale ---
    if (sourceType === "file") {
      if (!file) {
        throw new Error('Un fichier est requis pour le type "file"');
      }
      const supportedFileExtensions = await listSupportedFileExtensions();
      const validExtensions = supportedFileExtensions.data;
      const fileExtension = file.originalname.split(".").pop().toLowerCase();
      if (!validExtensions.includes(fileExtension)) {
        throw new Error(
          `Format de fichier non pris en charge. Formats acceptés : ${validExtensions.join(
            ", "
          )}`
        );
      }
      filePath = `dataworkspace/finalresults/${userId}/final_${generateTimestamp()}.${fileExtension}`;
      await minioClient.putObject(BUCKET_NAME, filePath, file.buffer);
      metadataToStore = {
        file_path: filePath,
        original_filename: file.originalname,
        fileFormat: fileExtension,
      };
      fileFormat = fileExtension;
    } else if (sourceType === "database") {
      if (!metadata) {
        throw new Error(
          'Les détails de connexion sont requis pour le type "database"'
        );
      }
      const { host, port, dialect, username, password, dbname } = metadata;
      if (!host || !port || !dialect || !username || !password || !dbname) {
        throw new Error(
          "Tous les champs sont requis pour une source de type database : host, port, dialect, username, password, dbname"
        );
      }
      // Test de connexion à la base de données
      await testDatabaseConnection({
        host,
        port,
        dialect,
        username,
        password,
        dbname,
      });
      metadataToStore = {
        host,
        port,
        dialect,
        username,
        password: encrypt(password),
        dbname,
      };
      fileFormat = "database";
    } else if (sourceType === "api") {
      if (!metadata) {
        throw new Error(
          'Les détails de connexion sont requis pour le type "api"'
        );
      }
      const { url, credentials } = metadata;
      if (!url) {
        throw new Error("L'URL est requise pour une source de type api");
      }
      try {
        new URL(url);
      } catch {
        throw new Error("L'URL fournie est invalide");
      }
      if (credentials) {
        if (
          !(
            (credentials.username && credentials.password) ||
            credentials.api_key
          )
        ) {
          throw new Error(
            "Les credentials doivent inclure username/password ou api_key"
          );
        }
      }
      metadataToStore = {
        url,
        credentials: credentials ? encrypt(JSON.stringify(credentials)) : null,
      };
      fileFormat = "api";
    }
    // Création dans FinalResults
    const finalResult = await FinalResults.create({
      user_id: userId,
      result_type: sourceType,
      result_name: sourceName,
      metadata: metadataToStore,
    });
    return {
      success: true,
      data: { final_result_id: finalResult.final_result_id },
      message: "Source finale ajoutée avec succès",
    };
  } else {
    // --- Cas source non-finale ---
    // let nonFinalSource = await NonFinalSources.create({
    //   user_id: userId,
    //   source_type: sourceType,
    //   source_name: sourceName,
    //   metadata: null, // sera mis à jour après
    // });
    let nonFinalSource;
    if (sourceType === "file") {
      if (!file) {
        throw new Error('Un fichier est requis pour le type "file"');
      }
      const supportedFileExtensions = await listSupportedFileExtensions();
      const validExtensions = supportedFileExtensions.data;
      const fileExtension = file.originalname.split(".").pop().toLowerCase();
      if (!validExtensions.includes(fileExtension)) {
        throw new Error(
          `Format de fichier non pris en charge. Formats acceptés : ${validExtensions.join(
            ", "
          )}`
        );
      }
      filePath = `dataworkspace/nonfinalsources/${userId}/source_${generateTimestamp()}.${fileExtension}`;
      await minioClient.putObject(BUCKET_NAME, filePath, file.buffer);
      metadataToStore = {
        file_path: filePath,
        original_filename: file.originalname,
        fileFormat: fileExtension,
      };
      fileFormat = fileExtension;
      // Mettre à jour la source avec le metadata
      nonFinalSource = await NonFinalSources.create({
        user_id: userId,
        source_type: sourceType,
        source_name: sourceName,
        metadata: metadataToStore, // sera mis à jour après
      });
      // Créer l'état initial dans ProcessingStates
      // await ProcessingStates.create({
      //   non_final_source_id: nonFinalSource.non_final_source_id,
      //   parent_state_id: null,
      //   version: 0,
      //   is_current: true,
      //   file_path: filePath,
      //   file_format: fileFormat,
      //   transformation_type: null,
      //   transformation_parameters: null,
      // });
    } else if (sourceType === "database") {
      if (!metadata) {
        throw new Error(
          'Les détails de connexion sont requis pour le type "database"'
        );
      }
      const { host, port, dialect, username, password, dbname } = metadata;
      if (!host || !port || !dialect || !username || !password || !dbname) {
        throw new Error(
          "Tous les champs sont requis pour une source de type database : host, port, dialect, username, password, dbname"
        );
      }
      // Test de connexion à la base de données
      await testDatabaseConnection({
        host,
        port,
        dialect,
        username,
        password,
        dbname,
      });
      metadataToStore = {
        host,
        port,
        dialect,
        username: encrypt(username),
        password: encrypt(password),
        dbname,
      };
      nonFinalSource = await NonFinalSources.create({
        user_id: userId,
        source_type: sourceType,
        source_name: sourceName,
        metadata: metadataToStore, // sera mis à jour après
      });
      // Pas d'état initial dans ProcessingStates tant qu'aucune extraction n'est faite
    } else if (sourceType === "api") {
      if (!metadata) {
        throw new Error(
          'Les détails de connexion sont requis pour le type "api"'
        );
      }
      const { url, credentials } = metadata;
      if (!url) {
        throw new Error("L'URL est requise pour une source de type api");
      }
      try {
        new URL(url);
      } catch {
        throw new Error("L'URL fournie est invalide");
      }
      if (credentials) {
        if (
          !(
            (credentials.username && credentials.password) ||
            credentials.api_key
          )
        ) {
          throw new Error(
            "Les credentials doivent inclure username/password ou api_key"
          );
        }
      }
      metadataToStore = {
        url,
        credentials: credentials ? encrypt(JSON.stringify(credentials)) : null,
      };
      nonFinalSource = await NonFinalSources.create({
        user_id: userId,
        source_type: sourceType,
        source_name: sourceName,
        metadata: metadataToStore, // sera mis à jour après
      });
      // Pas d'état initial dans ProcessingStates tant qu'aucune extraction n'est faite
    }
    return {
      success: true,
      data: { non_final_source_id: nonFinalSource.non_final_source_id },
      message: "Source non-finale ajoutée avec succès",
    };
  }
};

// Supprimer une source de données (NOUVEAU MODELE)
const deleteDataSource = async (userId, sourceId, isFinal) => {
  if (isFinal) {
    // Suppression dans FinalResults
    let finalSource = await FinalResults.findOne({
      where: { final_result_id: sourceId, user_id: userId },
    });
    if (!finalSource) {
      throw new Error("Source finale non trouvée ou non autorisée");
    }
    // Supprimer le fichier si c'est un fichier
    // if (
    //   finalSource.result_type === "file" &&
    //   finalSource.metadata?.file_path
    // ) {
    //   await minioClient.removeObject(BUCKET_NAME, finalSource.metadata.file_path);
    // }
    await finalSource.destroy();
    return { success: true, message: "Source finale supprimée avec succès" };
  } else {
    // Suppression dans NonFinalSources
    let nonFinalSource = await NonFinalSources.findOne({
      where: { non_final_source_id: sourceId, user_id: userId },
      include: [
        {
          model: ProcessingStates,
          as: "ProcessingStates",
        },
      ],
    });
    if (!nonFinalSource) {
      throw new Error("Source de données non trouvée ou non autorisée");
    }
    // Supprimer tous les fichiers liés aux états de traitement
    if (
      nonFinalSource.ProcessingStates &&
      nonFinalSource.ProcessingStates.length > 0
    ) {
      for (const state of nonFinalSource.ProcessingStates) {
        // if (state.file_path) {
        //   await minioClient.removeObject(BUCKET_NAME, state.file_path);
        // }
        await state.destroy();
      }
    }
    // Supprimer la source elle-même
    await nonFinalSource.destroy();
    return {
      success: true,
      message: "Source non-finale supprimée avec succès",
    };
  }
};

// Charger les données d'une source spécifique (NOUVEAU MODELE)
const loadDataFromSource = async (userId, sourceId, limit = 10, offset = 0) => {
  // Essayer d'abord comme source finale
  let finalSource = await FinalResults.findOne({
    where: { final_result_id: sourceId, user_id: userId },
  });
  if (finalSource) {
    if (finalSource.result_type === "file" && finalSource.metadata?.file_path) {
      const fileStream = await minioClient.getObject(
        BUCKET_NAME,
        finalSource.metadata.file_path
      );
      const fileData = await streamToBuffer(fileStream);
      let parsedData;
      const fileFormat = finalSource.metadata.fileFormat;
      switch (fileFormat) {
        case "csv":
          parsedData = Papa.parse(fileData.toString("utf-8"), {
            header: true,
          }).data;
          break;
        case "excel":
          const workbook = XLSX.read(fileData, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          parsedData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
          break;
        case "json":
        case "geojson":
          parsedData = JSON.parse(fileData.toString("utf-8"));
          break;
        case "xml":
          parsedData = await xml2js.parseStringPromise(
            fileData.toString("utf-8")
          );
          parsedData = flattenXml(parsedData);
          break;
        case "shapefile":
          parsedData = await handleZippedShapefile(fileData);
          break;
        default:
          throw new Error("Format de données non pris en charge");
      }
      if (!Array.isArray(parsedData)) parsedData = [parsedData];
      const total = parsedData.length;
      const paginatedData = parsedData.slice(offset, offset + limit);
      return {
        success: true,
        data: {
          source_id: finalSource.final_result_id,
          source_type: finalSource.result_type,
          source_name: finalSource.result_name,
          content: paginatedData,
          pagination: { limit, offset, total },
        },
      };
    } else {
      // Pour les sources finales non-fichiers (ex: database/api), retourner la metadata
      return {
        success: true,
        data: {
          source_id: finalSource.final_result_id,
          source_type: finalSource.result_type,
          source_name: finalSource.result_name,
          metadata: finalSource.metadata,
        },
      };
    }
  }
  // Sinon, essayer comme source non-finale
  let nonFinalSource = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId, user_id: userId },
    include: [
      {
        model: ProcessingStates,
        as: "ProcessingStates",
        where: { is_current: true },
        required: false,
      },
    ],
  });
  if (!nonFinalSource) {
    throw new Error("Source de données non trouvée ou non autorisée");
  }
  const currentState =
    nonFinalSource.ProcessingStates &&
    nonFinalSource.ProcessingStates.length > 0
      ? nonFinalSource.ProcessingStates[0]
      : null;
  if (!currentState || !currentState.file_path) {
    throw new Error(
      "Aucun état de traitement courant ou fichier associé à cette source"
    );
  }
  const fileStream = await minioClient.getObject(
    BUCKET_NAME,
    currentState.file_path
  );
  const fileData = await streamToBuffer(fileStream);
  let parsedData;
  switch (currentState.file_format) {
    case "csv":
      parsedData = Papa.parse(fileData.toString("utf-8"), {
        header: true,
      }).data;
      break;
    case "excel":
      const workbook = XLSX.read(fileData, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      parsedData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      break;
    case "json":
    case "geojson":
      parsedData = JSON.parse(fileData.toString("utf-8"));
      break;
    case "xml":
      parsedData = await xml2js.parseStringPromise(fileData.toString("utf-8"));
      parsedData = flattenXml(parsedData);
      break;
    case "shapefile":
      parsedData = await handleZippedShapefile(fileData);
      break;
    default:
      throw new Error("Format de données non pris en charge");
  }
  if (!Array.isArray(parsedData)) parsedData = [parsedData];
  const total = parsedData.length;
  const paginatedData = parsedData.slice(offset, offset + limit);
  return {
    success: true,
    data: {
      source_id: nonFinalSource.non_final_source_id,
      source_type: nonFinalSource.source_type,
      source_name: nonFinalSource.source_name,
      content: paginatedData,
      pagination: { limit, offset, total },
    },
  };
};

// Enregistrer un résultat (graphique, rapport, shapefile, etc.)
const saveResult = async (userId, sourceId, resultType, config, files) => {
  const validResultTypes = ["image", "report", "json", "geojson", "shapefile"];
  if (!validResultTypes.includes(resultType)) {
    throw new Error(
      "Type de résultat invalide. Valeurs acceptées : image, report, json, geojson, shapefile"
    );
  }

  // Vérifier la source (finale ou non-finale)
  let source = await FinalResults.findOne({
    where: { final_result_id: sourceId, user_id: userId },
  });
  let sourceType, sourceName;
  if (source) {
    sourceType = source.result_type;
    sourceName = source.result_name;
  } else {
    // Vérifier si c'est une source non-finale
    source = await NonFinalSources.findOne({
      where: { non_final_source_id: sourceId, user_id: userId },
    });
    if (!source) {
      throw new Error("Source de données non trouvée ou non autorisée");
    }
    sourceType = source.source_type;
    sourceName = source.source_name;
  }

  if (!files || files.length === 0) {
    throw new Error(
      "Au moins un fichier est requis pour enregistrer le résultat"
    );
  }

  const mimeTypes = [
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "application/geo+json",
    "application/json",
    "application/pdf",
    "application/zip",
    "application/octet-stream",
    "application/vnd.shp",
    "application/vnd.dbf",
    "application/vnd.shp.shx",
  ];

  for (const file of files) {
    if (!mimeTypes.includes(file.mimetype)) {
      throw new Error(
        `Type de fichier invalide : ${
          file.originalname
        }. Types acceptés : ${mimeTypes.join(", ")}`
      );
    }
    if (file.size === 0) {
      throw new Error(
        `Fichier vide : ${file.originalname}. Veuillez fournir un fichier valide.`
      );
    }
    if (
      resultType === "shapefile" &&
      file.mimetype !== "application/zip" &&
      file.mimetype !== "application/octet-stream" &&
      !file.mimetype.startsWith("application/vnd.")
    ) {
      throw new Error(
        `Type de fichier invalide pour un shapefile : ${file.originalname}. Un shapefile doit être un fichier ZIP ou un fichier binaire.`
      );
    }
    if (resultType === "image" && !file.mimetype.startsWith("image/")) {
      throw new Error(
        `Type de fichier invalide pour une image : ${file.originalname}. Un fichier image doit être de type image/png, image/jpeg ou image/svg+xml.`
      );
    }
    if (resultType === "report" && file.mimetype !== "application/pdf") {
      throw new Error(
        `Type de fichier invalide pour un rapport : ${file.originalname}. Un rapport doit être un fichier PDF.`
      );
    }
    if (
      resultType === "geojson" &&
      file.mimetype !== "application/json" &&
      file.mimetype !== "application/geo+json"
    ) {
      throw new Error(
        `Type de fichier invalide pour un GeoJSON : ${file.originalname}. Un GeoJSON doit être un fichier JSON ou GeoJSON.`
      );
    }
    if (resultType === "json" && file.mimetype !== "application/json") {
      throw new Error(
        `Type de fichier invalide pour un JSON : ${file.originalname}. Un JSON doit être un fichier JSON.`
      );
    }
  }

  let format, filePath, fileBuffer;

  // Cas 1 : Shapefile avec fichiers individuels (.shp, .shx, .dbf)
  if (resultType === "shapefile" && files.length > 1) {
    format = "shapefile";
    const fileNames = files.map((file) => file.originalname.toLowerCase());
    const hasShp = fileNames.some((name) => name.endsWith(".shp"));
    const hasShx = fileNames.some((name) => name.endsWith(".shx"));
    const hasDbf = fileNames.some((name) => name.endsWith(".dbf"));
    if (!hasShp || !hasShx || !hasDbf) {
      throw new Error("Un shapefile doit inclure .shp, .shx et .dbf");
    }
    const zip = new AdmZip();
    files.forEach((file) => {
      zip.addFile(file.originalname, file.buffer);
    });
    fileBuffer = zip.toBuffer();
    filePath = `dataworkspace/finalresults/${userId}/result_${generateTimestamp()}.zip`;
  } else if (files.length === 1) {
    const file = files[0];
    format =
      resultType === "shapefile"
        ? "shapefile"
        : file.mimetype.split("/")[1].split("+")[0];
    fileBuffer = file.buffer;
    const ext = file.originalname.split(".").pop().toLowerCase();
    filePath = `dataworkspace/finalresults/${userId}/result_${generateTimestamp()}.${ext}`;
  } else {
    throw new Error("Format de résultat non supporté");
  }

  await minioClient.putObject(BUCKET_NAME, filePath, fileBuffer);

  // Enregistrer dans FinalResults
  const finalResult = await FinalResults.create({
    user_id: userId,
    result_type: resultType,
    result_name: sourceName + " - résultat " + resultType,
    metadata: {
      file_path: filePath,
      format,
      config: config || {},
      source_id: sourceId,
      source_type: sourceType,
    },
  });

  return {
    success: true,
    final_result_id: finalResult.final_result_id,
    file_path: filePath,
    message: "Résultat enregistré avec succès",
  };
};

// Télécharger un fichier de résultat (nouveau modèle)
const downloadResult = async (userId, finalResultId) => {
  const result = await FinalResults.findOne({
    where: { final_result_id: finalResultId, user_id: userId },
  });
  if (!result) {
    throw new Error("Résultat non trouvé ou non autorisé");
  }
  if (!result.metadata?.file_path) {
    throw new Error("Aucun fichier associé à ce résultat");
  }
  const downloadUrl = await minioClient.presignedGetObject(
    BUCKET_NAME,
    result.metadata.file_path,
    60 * 60
  );
  return {
    success: true,
    download_url: downloadUrl,
    message: "URL de téléchargement générée",
  };
};

// Soumettre un résultat final pour validation
const submitResult = async (userId, finalResultId, comments) => {
  // Vérifier le résultat final
  const result = await FinalResults.findOne({
    where: { final_result_id: finalResultId, user_id: userId },
  });
  if (!result) {
    throw new Error("Résultat final non trouvé ou non autorisé");
  }
  // Créer la soumission
  const submission = await Submissions.create({
    user_id: userId,
    final_result_id: finalResultId,
    submission_status: "pending",
    submission_comments: comments || null,
  });
  return {
    success: true,
    submission_id: submission.submission_id,
    status: submission.submission_status,
    message: "Soumission enregistrée avec succès",
  };
};

// Récupérer le statut d'une soumission
const getSubmissionStatus = async (userId, submissionId) => {
  const submission = await Submissions.findOne({
    where: { submission_id: submissionId, user_id: userId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée ou non autorisée");
  }

  return {
    success: true,
    submission_id: submission.submission_id,
    status: submission.submission_status,
  };
};

// Mettre à jour une soumission
const updateSubmission = async (
  userId,
  submissionId,
  finalResultId,
  comments
) => {
  const submission = await Submissions.findOne({
    where: { submission_id: submissionId, user_id: userId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée ou non autorisée");
  }
  if (
    !["pending", "revision_requested"].includes(submission.submission_status)
  ) {
    throw new Error(
      "Seules les soumissions en attente ou en révision peuvent être mises à jour"
    );
  }
  if (!finalResultId && !comments) {
    throw new Error(
      "Au moins un champ à mettre à jour est requis (final_result_id, comments)"
    );
  }
  if (finalResultId) {
    const result = await FinalResults.findOne({
      where: { final_result_id: finalResultId, user_id: userId },
    });
    if (!result) {
      throw new Error("Résultat final non trouvé ou non autorisé");
    }
  }
  await submission.update({
    final_result_id: finalResultId || submission.final_result_id,
    submission_status: "pending",
    submission_comments: comments || submission.submission_comments,
  });
  return {
    success: true,
    submission_id: submission.submission_id,
    status: "updated",
  };
};

// Annuler une soumission
const cancelSubmission = async (userId, submissionId) => {
  const submission = await Submissions.findOne({
    where: { submission_id: submissionId, user_id: userId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée ou non autorisée");
  }

  if (
    !["pending", "revision_requested"].includes(submission.submission_status)
  ) {
    throw new Error(
      "Seules les soumissions en attente ou en révision peuvent être annulées"
    );
  }

  await submission.destroy();

  // Enregistrer l'étape
  // await ProcessingSteps.create({
  //   dataset_id: submission.dataset_id,
  //   step_type: "submission_cancel",
  //   step_description: `Annulation de la soumission ${submissionId}`,
  //   parameters: { submission_id: submissionId },
  //   result_dataset_id: null,
  // });

  return {
    success: true,
    submission_id: submissionId,
    status: "cancelled",
  };
};

// Mettre à jour le statut d'une soumission
const updateSubmissionStatus = async (user, submissionId, status) => {
  const validStatuses = [
    "pending",
    "approved",
    "rejected",
    "revision_requested",
  ];
  if (!validStatuses.includes(status)) {
    throw new Error(
      "Statut invalide. Valeurs acceptées : pending, approved, rejected, revision_requested"
    );
  }

  const submission = await Submissions.findOne({
    where: { submission_id: submissionId },
  });
  if (!submission) {
    throw new Error("Soumission non trouvée");
  }

  // Vérifier si l'utilisateur est un validateur (exemple simplifié)

  const userRoles = user.roles; // Récupérer le rôle de l'utilisateur
  const isValidator = userRoles.includes("ROLE_VALIDATOR"); // Vérifier si l'utilisateur est un validateur

  if (!isValidator) {
    throw new Error("Seuls les validateurs peuvent mettre à jour le statut");
  }

  await submission.update({
    submission_status: status,
  });

  // Enregistrer l'étape
  // await ProcessingSteps.create({
  //   dataset_id: submission.dataset_id,
  //   step_type: "submission_status_update",
  //   step_description: `Mise à jour du statut de la soumission ${submissionId} à ${status}`,
  //   parameters: { submission_id: submissionId, status },
  //   result_dataset_id: null,
  // });

  return {
    success: true,
    submission_id: submission.submission_id,
    status,
  };
};

// Teste la connexion à une base de données selon le dialecte
const testDatabaseConnection = async ({
  host,
  port,
  dialect,
  username,
  password,
  dbname,
}) => {
  if (dialect === "mysql" || dialect === "mariadb") {
    const mysql = require("mysql2/promise");
    let connection;
    try {
      connection = await mysql.createConnection({
        host,
        port,
        user: username,
        password,
        database: dbname,
      });
      await connection.ping();
      await connection.end();
      return true;
    } catch (err) {
      throw new Error(
        "Connexion à la base MySQL/MariaDB impossible : " + err.message
      );
    }
  } else if (dialect === "postgres") {
    const { Client } = require("pg");
    const client = new Client({
      host,
      port,
      user: username,
      password,
      database: dbname,
    });
    try {
      await client.connect();
      await client.end();
      return true;
    } catch (err) {
      throw new Error(
        "Connexion à la base PostgreSQL impossible : " + err.message
      );
    }
  } else if (dialect === "sqlite") {
    const sqlite3 = require("sqlite3");
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbname, (err) => {
        if (err)
          reject(new Error("Connexion SQLite impossible : " + err.message));
        else {
          db.close();
          resolve(true);
        }
      });
    });
  } else if (dialect === "mongodb") {
    const { MongoClient } = require("mongodb");
    const url = `mongodb://${username}:${password}@${host}:${port}/${dbname}`;
    const client = new MongoClient(url);
    try {
      await client.connect();
      await client.close();
      return true;
    } catch (err) {
      throw new Error("Connexion à MongoDB impossible : " + err.message);
    }
  } else {
    throw new Error("Dialecte non supporté pour la vérification de connexion");
  }
};

// Lister les fichiers supportés
const listSupportedFileExtensions = async () => {
  const files = await SupportedFileExtensions.findAll({
    where: { status: "active" },
    attributes: ["file_extension"],
  });
  return {
    success: true,
    data: files.map((f) => f.file_extension),
    message: "Fichiers supportés récupérés avec succès",
  };
};

// Lister les types de bases de données supportés
const listSupportedDatabaseTypes = async () => {
  const dbTypes = await SupportedDatabaseTypes.findAll({
    where: { status: "active" },
    attributes: ["db_type"],
  });
  return {
    success: true,
    data: dbTypes.map((db) => db.db_type),
    message: "Types de bases de données supportés récupérés avec succès",
  };
};

// Lister les graphiques supportés
const listSupportedCharts = async () => {
  const charts = await SupportedCharts.findAll({
    where: { status: "active" },
    attributes: ["chart_name", "required_parameters"],
  });
  return {
    success: true,
    data: charts.map((chart) => ({
      chart_name: chart.chart_name,
      required_parameters: chart.required_parameters,
    })),
    message: "Graphiques supportés récupérés avec succès",
  };
};

// Lister les tables d'une source de base de données (nouveau modèle)
const listTablesOfDatabaseSource = async (sourceId) => {
  const source = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId },
  });
  if (!source || source.source_type !== "database") {
    throw new Error("Source de type base de données non trouvée");
  }

  const metadata = source.metadata;
  if (!metadata) throw new Error("Aucun metadata de connexion trouvé");
  const { host, port, dialect, username, password, dbname } = metadata;
  if (!host || !port || !dialect || !username || !password || !dbname) {
    throw new Error("Champs de connexion manquants dans le metadata");
  }
  let decryptedUsername =
    typeof username === "object" ? decrypt(username) : username;
  let decryptedPassword =
    typeof password === "object" ? decrypt(password) : password;
  if (dialect === "mysql" || dialect === "mariadb") {
    const mysql = require("mysql2/promise");
    const connection = await mysql.createConnection({
      host,
      port,
      user: decryptedUsername,
      password: decryptedPassword,
      database: dbname,
    });
    const [rows] = await connection.query("SHOW TABLES");
    await connection.end();
    // The key is 'Tables_in_<dbname>'
    const tableKey = Object.keys(rows[0] || {}).find((k) =>
      k.toLowerCase().includes("tables_in_")
    );
    const tables = rows.map((row) => row[tableKey]);
    return { success: true, tables };
  } else if (dialect === "postgres") {
    const { Client } = require("pg");
    const client = new Client({
      host,
      port,
      user: decryptedUsername,
      password: decryptedPassword,
      database: dbname,
    });
    await client.connect();
    const res = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    await client.end();
    return { success: true, tables: res.rows.map((r) => r.table_name) };
  } else if (dialect === "sqlite") {
    const sqlite3 = require("sqlite3");
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbname, (err) => {
        if (err)
          return reject(
            new Error("Connexion SQLite impossible : " + err.message)
          );
        db.all(
          "SELECT name FROM sqlite_master WHERE type='table'",
          (err, rows) => {
            db.close();
            if (err)
              return reject(
                new Error(
                  "Erreur lors de la récupération des tables SQLite : " +
                    err.message
                )
              );
            resolve({ success: true, tables: rows.map((r) => r.name) });
          }
        );
      });
    });
  } else if (dialect === "mongodb") {
    const { MongoClient } = require("mongodb");
    const url = `mongodb://${decryptedUsername}:${decryptedPassword}@${host}:${port}/${dbname}`;
    const client = new MongoClient(url);
    await client.connect();
    const db = client.db(dbname);
    const collections = await db.listCollections().toArray();
    await client.close();
    return { success: true, tables: collections.map((c) => c.name) };
  } else {
    throw new Error("Dialecte non supporté pour l'introspection des tables");
  }
};

// Lister les colonnes d'une table d'une source de base de données (nouveau modèle)
const listColumnsOfTable = async (sourceId, tableName) => {
  const source = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId },
  });
  if (!source || source.source_type !== "database") {
    throw new Error("Source de type base de données non trouvée");
  }

  const metadata = source.metadata;
  if (!metadata) throw new Error("Aucun metadata de connexion trouvé");
  const { host, port, dialect, username, password, dbname } = metadata;
  if (!host || !port || !dialect || !username || !password || !dbname) {
    throw new Error("Champs de connexion manquants dans le metadata");
  }
  let decryptedUsername =
    typeof username === "object" ? decrypt(username) : username;
  let decryptedPassword =
    typeof password === "object" ? decrypt(password) : password;
  if (dialect === "mysql" || dialect === "mariadb") {
    const mysql = require("mysql2/promise");
    const connection = await mysql.createConnection({
      host,
      port,
      user: decryptedUsername,
      password: decryptedPassword,
      database: dbname,
    });
    if (!isValidDbIdentifier(tableName)) {
      throw new Error("Nom de table invalide");
    }
    const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
    await connection.end();
    return { success: true, columns: rows.map((r) => r.Field) };
  } else if (dialect === "postgres") {
    const { Client } = require("pg");
    const client = new Client({
      host,
      port,
      user: decryptedUsername,
      password: decryptedPassword,
      database: dbname,
    });
    await client.connect();
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
      [tableName]
    );
    await client.end();
    return { success: true, columns: res.rows.map((r) => r.column_name) };
  } else if (dialect === "sqlite") {
    const sqlite3 = require("sqlite3");
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbname, (err) => {
        if (err)
          return reject(
            new Error("Connexion SQLite impossible : " + err.message)
          );
        if (!isValidDbIdentifier(tableName)) {
          db.close();
          return reject(new Error("Nom de table invalide"));
        }
        db.all(`PRAGMA table_info("${tableName}")`, (err, rows) => {
          db.close();
          if (err)
            return reject(
              new Error(
                "Erreur lors de la récupération des colonnes SQLite : " +
                  err.message
              )
            );
          resolve({ success: true, columns: rows.map((r) => r.name) });
        });
      });
    });
  } else if (dialect === "mongodb") {
    const { MongoClient } = require("mongodb");
    const url = `mongodb://${decryptedUsername}:${decryptedPassword}@${host}:${port}/${dbname}`;
    const client = new MongoClient(url);
    await client.connect();
    const db = client.db(dbname);
    const sample = await db.collection(tableName).findOne();
    await client.close();
    if (!sample) return { success: true, columns: [] };
    return { success: true, columns: Object.keys(sample) };
  } else {
    throw new Error("Dialecte non supporté pour l'introspection des colonnes");
  }
};

// Lister les tables avec colonnes et compte des lignes
const listTablesWithColumnsAndCount = async (sourceId) => {
  const source = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId },
  });
  if (!source || source.source_type !== "database") {
    throw new Error("Source de type base de données non trouvée");
  }
  const metadata = source.metadata;
  if (!metadata) throw new Error("Aucun metadata de connexion trouvé");
  const { host, port, dialect, username, password, dbname } = metadata;
  let decryptedUsername =
    typeof username === "object" ? decrypt(username) : username;
  let decryptedPassword =
    typeof password === "object" ? decrypt(password) : password;

  if (dialect === "mysql" || dialect === "mariadb") {
    const mysql = require("mysql2/promise");
    const connection = await mysql.createConnection({
      host,
      port,
      user: decryptedUsername,
      password: decryptedPassword,
      database: dbname,
    });
    const [tablesRows] = await connection.query("SHOW TABLES");
    const tableKey = Object.keys(tablesRows[0] || {}).find((k) =>
      k.toLowerCase().includes("tables_in_")
    );
    const tables = tablesRows.map((row) => row[tableKey]);
    const result = [];
    for (const table of tables) {
      if (!isValidDbIdentifier(table)) {
        throw new Error(`Nom de table invalide: ${table}`);
      }
      const [columnsRows] = await connection.query(
        `SHOW COLUMNS FROM \`${table}\``
      );
      const columns = columnsRows.map((col) => col.Field);
      const [countRows] = await connection.query(
        `SELECT COUNT(*) as count FROM \`${table}\``
      );
      result.push({
        name: table,
        columns,
        rowCount: countRows[0].count,
      });
    }
    await connection.end();
    return { success: true, tables: result };
  } else if (dialect === "postgres") {
    const { Client } = require("pg");
    const client = new Client({
      host,
      port,
      user: decryptedUsername,
      password: decryptedPassword,
      database: dbname,
    });
    await client.connect();
    const res = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const tables = res.rows.map((r) => r.table_name);
    const result = [];
    for (const table of tables) {
      const colRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
        [table]
      );
      const columns = colRes.rows.map((r) => r.column_name);
      const countRes = await client.query(
        `SELECT COUNT(*) as count FROM "${table}"`
      );
      result.push({
        name: table,
        columns,
        rowCount: parseInt(countRes.rows[0].count, 10),
      });
    }
    await client.end();
    return { success: true, tables: result };
  } else if (dialect === "sqlite") {
    const sqlite3 = require("sqlite3");
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbname, (err) => {
        if (err)
          return reject(
            new Error("Connexion SQLite impossible : " + err.message)
          );
        db.all(
          "SELECT name FROM sqlite_master WHERE type='table'",
          async (err, rows) => {
            if (err) {
              db.close();
              return reject(
                new Error(
                  "Erreur lors de la récupération des tables SQLite : " +
                    err.message
                )
              );
            }
            const tables = rows.map((r) => r.name);
            const result = [];
            let processed = 0;
            for (const table of tables) {
              if (!isValidDbIdentifier(table)) {
                db.close();
                return reject(new Error(`Nom de table invalide: ${table}`));
              }
              db.all(`PRAGMA table_info("${table}")`, (err, colRows) => {
                if (err) {
                  db.close();
                  return reject(
                    new Error(
                      "Erreur lors de la récupération des colonnes SQLite : " +
                        err.message
                    )
                  );
                }
                const columns = colRows.map((c) => c.name);
                db.get(
                  `SELECT COUNT(*) as count FROM "${table}"`,
                  (err, countRow) => {
                    if (err) {
                      db.close();
                      return reject(
                        new Error(
                          "Erreur lors du comptage SQLite : " + err.message
                        )
                      );
                    }
                    result.push({
                      name: table,
                      columns,
                      rowCount: countRow.count,
                    });
                    processed++;
                    if (processed === tables.length) {
                      db.close();
                      resolve({ success: true, tables: result });
                    }
                  }
                );
              });
            }
          }
        );
      });
    });
  } else if (dialect === "mongodb") {
    const { MongoClient } = require("mongodb");
    const url = `mongodb://${decryptedUsername}:${decryptedPassword}@${host}:${port}/${dbname}`;
    const client = new MongoClient(url);
    await client.connect();
    const db = client.db(dbname);
    const collections = await db.listCollections().toArray();
    const result = [];
    for (const col of collections) {
      const sample = await db.collection(col.name).findOne();
      const columns = sample ? Object.keys(sample) : [];
      const rowCount = await db.collection(col.name).countDocuments();
      result.push({
        name: col.name,
        columns,
        rowCount,
      });
    }
    await client.close();
    return { success: true, tables: result };
  } else {
    throw new Error("Dialecte non supporté pour l'introspection des tables");
  }
};

// Créer l'état initial (version 0) dans ProcessingStates pour une source
const createInitialProcessingState = async ({
  userId,
  sourceId,
  columns,
  tableName = null,
}) => {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("Aucune colonne sélectionnée");
  }

  const source = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId, user_id: userId },
  });
  if (!source) throw new Error("Source non trouvée");
  const sourceType = source.source_type;
  const metadata = source.metadata;
  let dataRows = [];
  let fileFormat = "csv";
  let filePath;
  let transformationParameters = { columns };
  if (tableName) transformationParameters.table = tableName;

  if (sourceType === "database") {
    // Vérification des identifiants de table et colonnes
    if (tableName && !isValidDbIdentifier(tableName)) {
      throw new Error("Nom de table invalide (caractères non autorisés)");
    }
    for (const col of columns) {
      if (!isValidDbIdentifier(col)) {
        throw new Error(`Nom de colonne invalide : ${col}`);
      }
    }
    if (!tableName)
      throw new Error("Le nom de la table est requis pour une base de données");
    const { host, port, dialect, username, password, dbname } = metadata;
    let decryptedUsername =
      typeof username === "object" ? decrypt(username) : username;
    let decryptedPassword =
      typeof password === "object" ? decrypt(password) : password;
    try {
      if (dialect === "mysql" || dialect === "mariadb") {
        const mysql = require("mysql2/promise");
        const connection = await mysql.createConnection({
          host,
          port,
          user: decryptedUsername,
          password: decryptedPassword,
          database: dbname,
        });
        // Vérifier l'existence de la table
        // const [tables] = await connection.query("SHOW TABLES");
        // const tableKey = Object.keys(tables[0] || {}).find((k) => k.toLowerCase().includes("tables_in_"));
        // const tableNames = tables.map((row) => row[tableKey]);
        // if (!tableNames.includes(tableName)) {
        //   await connection.end();
        //   throw new Error(`Table non trouvée : ${tableName}`);
        // }
        // Vérifier l'existence des colonnes
        // const [columnsInfo] = await connection.query(`SHOW COLUMNS FROM \\`${tableName}\\``.replace(/\\/g, ''));
        // const availableCols = columnsInfo.map((c) => c.Field);
        // for (const col of columns) {
        //   if (!availableCols.includes(col)) {
        //     await connection.end();
        //     throw new Error(`Colonne non trouvée dans la table : ${col}`);
        //   }
        // }
        const colList = columns.map((c) => `\`${c}\``).join(", ");
        const [rows] = await connection.query(
          `SELECT ${colList} FROM \`${tableName}\``
        );
        dataRows = rows;
        await connection.end();
      } else if (dialect === "postgres") {
        const { Client } = require("pg");
        const client = new Client({
          host,
          port,
          user: decryptedUsername,
          password: decryptedPassword,
          database: dbname,
        });
        await client.connect();
        // Vérifier l'existence de la table
        // const tableRes = await client.query(
        //   `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        //   [tableName]
        // );
        // if (tableRes.rows.length === 0) {
        //   await client.end();
        //   throw new Error(`Table non trouvée : ${tableName}`);
        // }
        // Vérifier l'existence des colonnes
        // const colRes = await client.query(
        //   `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
        //   [tableName]
        // );
        // const availableCols = colRes.rows.map((r) => r.column_name);
        // for (const col of columns) {
        //   if (!availableCols.includes(col)) {
        //     await client.end();
        //     throw new Error(`Colonne non trouvée dans la table : ${col}`);
        //   }
        // }
        const colList = columns.map((c) => `"${c}"`).join(", ");
        const res = await client.query(`SELECT ${colList} FROM "${tableName}"`);
        dataRows = res.rows;
        await client.end();
      } else if (dialect === "sqlite") {
        const sqlite3 = require("sqlite3");
        const db = new sqlite3.Database(dbname);
        // Vérifier l'existence de la table
        // const tables = await new Promise((resolve, reject) => {
        //   db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
        //     if (err) return reject(err);
        //     resolve(rows.map((r) => r.name));
        //   });
        // });
        // if (!tables.includes(tableName)) {
        //   db.close();
        //   throw new Error(`Table non trouvée : ${tableName}`);
        // }
        // Vérifier l'existence des colonnes
        // const colRows = await new Promise((resolve, reject) => {
        //   db.all(`PRAGMA table_info(\"${tableName}\")`, (err, rows) => {
        //     if (err) return reject(err);
        //     resolve(rows);
        //   });
        // });
        // const availableCols = colRows.map((c) => c.name);
        // for (const col of columns) {
        //   if (!availableCols.includes(col)) {
        //     db.close();
        //     throw new Error(`Colonne non trouvée dans la table : ${col}`);
        //   }
        // }
        dataRows = await new Promise((resolve, reject) => {
          db.all(
            `SELECT ${columns
              .map((c) => `\"${c}\"`)
              .join(", ")} FROM \"${tableName}\"`,
            (err, rows) => {
              db.close();
              if (err) return reject(err);
              resolve(rows);
            }
          );
        });
      } else {
        throw new Error("Dialecte non supporté pour l'import initial");
      }
    } catch (err) {
      throw new Error(
        `Erreur lors de l'extraction des données : ${err.message}`
      );
    }
  } else if (sourceType === "file") {
    if (!metadata || !metadata.file_path || !metadata.fileFormat) {
      throw new Error("Métadonnées de fichier incomplètes");
    }
    const fileStream = await minioClient.getObject(
      BUCKET_NAME,
      metadata.file_path
    );
    const fileBuffer = await streamToBuffer(fileStream);
    let availableCols = [];
    if (["csv", "txt"].includes(metadata.fileFormat)) {
      const parsed = Papa.parse(fileBuffer.toString("utf8"), { header: true });
      if (!parsed.data || parsed.data.length === 0) {
        throw new Error("Aucune donnée trouvée dans le fichier");
      }
      availableCols = Object.keys(parsed.data[0]);
      for (const col of columns) {
        if (!availableCols.includes(col)) {
          throw new Error(`Colonne non trouvée dans le fichier : ${col}`);
        }
      }
      dataRows = parsed.data.map((row) => {
        const filtered = {};
        columns.forEach((col) => {
          filtered[col] = row[col];
        });
        return filtered;
      });
    } else if (["xls", "xlsx"].includes(metadata.fileFormat)) {
      const workbook = XLSX.read(fileBuffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet);
      if (!json || json.length === 0) {
        throw new Error("Aucune donnée trouvée dans le fichier Excel");
      }
      availableCols = Object.keys(json[0]);
      for (const col of columns) {
        if (!availableCols.includes(col)) {
          throw new Error(`Colonne non trouvée dans le fichier : ${col}`);
        }
      }
      dataRows = json.map((row) => {
        const filtered = {};
        columns.forEach((col) => {
          filtered[col] = row[col];
        });
        return filtered;
      });
    } else {
      throw new Error("Format de fichier non supporté pour l'import initial");
    }
  } else {
    throw new Error("Type de source non supporté pour l'import initial");
  }
  // Générer le CSV
  const csv = Papa.unparse(dataRows);
  filePath = `dataworkspace/processingstates/${userId}/source_${sourceId}_processing_v0_${generateTimestamp()}.csv`;
  await minioClient.putObject(BUCKET_NAME, filePath, Buffer.from(csv, "utf8"));
  // Créer l'entrée ProcessingStates
  const state = await ProcessingStates.create({
    non_final_source_id: sourceId,
    parent_state_id: null,
    version: 0,
    is_current: true,
    file_path: filePath,
    file_format: "csv",
    transformation_type: "initial_import",
    transformation_parameters: transformationParameters,
  });
  return { success: true, state_id: state.state_id, file_path: filePath };
};

// Récupère l'état initial (version 0) d'une source, lit le CSV et retourne le JSON (avec limite/offset)
const getInitialStateAsJson = async ({
  userId,
  sourceId,
  limit = 100,
  offset = 0,
}) => {
  // Chercher l'état version 0 le plus récent pour la source
  const state = await ProcessingStates.findOne({
    where: {
      non_final_source_id: sourceId,
      version: 0,
    },
    order: [["created_at", "DESC"]],
  });
  if (!state)
    throw new Error("Aucun état initial (version 0) trouvé pour cette source");
  if (!state.file_path) throw new Error("Aucun fichier associé à cet état");
  // Récupérer le fichier CSV depuis MinIO
  const fileStream = await minioClient.getObject(BUCKET_NAME, state.file_path);
  const fileBuffer = await streamToBuffer(fileStream);
  // Gérer le BOM éventuel
  let csvString = fileBuffer.toString("utf8");
  if (csvString.charCodeAt(0) === 0xfeff) csvString = csvString.slice(1);
  // Parser le CSV
  const parsed = Papa.parse(csvString, { header: true });
  if (!parsed.data || parsed.data.length === 0) {
    return {
      success: true,
      data: [],
      total: 0,
      limit,
      offset,
      columns: parsed.meta.fields || [],
      table: state.transformation_parameters?.table || null,
    };
  }
  // Pagination
  const total = parsed.data.length;
  const paginated = parsed.data.slice(offset, offset + limit);
  return {
    success: true,
    state_id: state.state_id,
    table: state.transformation_parameters?.table || null,
    columns: parsed.meta.fields || [],
    data: paginated,
    total,
    limit,
    offset,
  };
};

// Prévisualise les données d'une source (DB ou fichier) pour les colonnes sélectionnées, sans créer d'état.
const previewSelectedColumns = async ({
  userId,
  sourceId,
  columns,
  tableName = null,
  limit = 100,
  offset = 0,
}) => {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("Aucune colonne sélectionnée");
  }
  const source = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId, user_id: userId },
  });
  if (!source) throw new Error("Source non trouvée");
  const sourceType = source.source_type;
  const metadata = source.metadata;
  let dataRows = [];
  let columnsAvailable = [];
  let table = tableName || null;
  if (sourceType === "database") {
    if (tableName && !isValidDbIdentifier(tableName)) {
      throw new Error("Nom de table invalide (caractères non autorisés)");
    }
    for (const col of columns) {
      if (!isValidDbIdentifier(col)) {
        throw new Error(`Nom de colonne invalide : ${col}`);
      }
    }
    if (!tableName)
      throw new Error("Le nom de la table est requis pour une base de données");
    const { host, port, dialect, username, password, dbname } = metadata;
    let decryptedUsername =
      typeof username === "object" ? decrypt(username) : username;
    let decryptedPassword =
      typeof password === "object" ? decrypt(password) : password;
    try {
      if (dialect === "mysql" || dialect === "mariadb") {
        const mysql = require("mysql2/promise");
        const connection = await mysql.createConnection({
          host,
          port,
          user: decryptedUsername,
          password: decryptedPassword,
          database: dbname,
        });
        const [columnsInfo] = await connection.query(
          `SHOW COLUMNS FROM \`${tableName}\``
        );
        columnsAvailable = columnsInfo.map((c) => c.Field);
        for (const col of columns) {
          if (!columnsAvailable.includes(col)) {
            await connection.end();
            throw new Error(`Colonne non trouvée dans la table : ${col}`);
          }
        }
        const colList = columns.map((c) => `\`${c}\``).join(", ");
        const [rows] = await connection.query(
          `SELECT ${colList} FROM \`${tableName}\` LIMIT ? OFFSET ?`,
          [limit, offset]
        );
        dataRows = rows;
        await connection.end();
      } else if (dialect === "postgres") {
        const { Client } = require("pg");
        const client = new Client({
          host,
          port,
          user: decryptedUsername,
          password: decryptedPassword,
          database: dbname,
        });
        await client.connect();
        const colRes = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
          [tableName]
        );
        columnsAvailable = colRes.rows.map((r) => r.column_name);
        for (const col of columns) {
          if (!columnsAvailable.includes(col)) {
            await client.end();
            throw new Error(`Colonne non trouvée dans la table : ${col}`);
          }
        }
        const colList = columns.map((c) => `"${c}"`).join(", ");
        const res = await client.query(
          `SELECT ${colList} FROM "${tableName}" LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        dataRows = res.rows;
        await client.end();
      } else if (dialect === "sqlite") {
        const sqlite3 = require("sqlite3");
        const db = new sqlite3.Database(dbname);
        const colRows = await new Promise((resolve, reject) => {
          db.all(`PRAGMA table_info(\"${tableName}\")`, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
          });
        });
        columnsAvailable = colRows.map((c) => c.name);
        for (const col of columns) {
          if (!columnsAvailable.includes(col)) {
            db.close();
            throw new Error(`Colonne non trouvée dans la table : ${col}`);
          }
        }
        dataRows = await new Promise((resolve, reject) => {
          db.all(
            `SELECT ${columns
              .map((c) => `\"${c}\"`)
              .join(
                ", "
              )} FROM \"${tableName}\" LIMIT ${limit} OFFSET ${offset}`,
            (err, rows) => {
              db.close();
              if (err) return reject(err);
              resolve(rows);
            }
          );
        });
      } else {
        throw new Error("Dialecte non supporté pour la prévisualisation");
      }
    } catch (err) {
      throw new Error(
        `Erreur lors de l'extraction des données : ${err.message}`
      );
    }
  } else if (sourceType === "file") {
    if (!metadata || !metadata.file_path || !metadata.fileFormat) {
      throw new Error("Métadonnées de fichier incomplètes");
    }
    const fileStream = await minioClient.getObject(
      BUCKET_NAME,
      metadata.file_path
    );
    const fileBuffer = await streamToBuffer(fileStream);
    if (["csv", "txt"].includes(metadata.fileFormat)) {
      const parsed = Papa.parse(fileBuffer.toString("utf8"), { header: true });
      if (!parsed.data || parsed.data.length === 0) {
        throw new Error("Aucune donnée trouvée dans le fichier");
      }
      columnsAvailable = Object.keys(parsed.data[0]);
      for (const col of columns) {
        if (!columnsAvailable.includes(col)) {
          throw new Error(`Colonne non trouvée dans le fichier : ${col}`);
        }
      }
      dataRows = parsed.data
        .map((row) => {
          const filtered = {};
          columns.forEach((col) => {
            filtered[col] = row[col];
          });
          return filtered;
        })
        .slice(offset, offset + limit);
    } else if (["xls", "xlsx"].includes(metadata.fileFormat)) {
      const workbook = XLSX.read(fileBuffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet);
      if (!json || json.length === 0) {
        throw new Error("Aucune donnée trouvée dans le fichier Excel");
      }
      columnsAvailable = Object.keys(json[0]);
      for (const col of columns) {
        if (!columnsAvailable.includes(col)) {
          throw new Error(`Colonne non trouvée dans le fichier : ${col}`);
        }
      }
      dataRows = json
        .map((row) => {
          const filtered = {};
          columns.forEach((col) => {
            filtered[col] = row[col];
          });
          return filtered;
        })
        .slice(offset, offset + limit);
    } else {
      throw new Error(
        "Format de fichier non supporté pour la prévisualisation"
      );
    }
  } else {
    throw new Error("Type de source non supporté pour la prévisualisation");
  }
  return {
    success: true,
    table,
    columns,
    data: dataRows,
    limit,
    offset,
    total: dataRows.length,
  };
};

// Récupère l'historique des traitements pour un état donné (états enfants)
const getProcessingStateHistory = async ({ stateId }) => {
  if (!stateId) throw new Error("stateId requis");
  const state = await ProcessingStates.findOne({
    where: { state_id: stateId },
    attributes: [
      "state_id",
      "version",
      "transformation_type",
      "transformation_parameters",
      "created_at",
    ],
  });
  const childStates = await ProcessingStates.findAll({
    where: { parent_state_id: stateId },
    attributes: [
      "state_id",
      "version",
      "transformation_type",
      "transformation_parameters",
      "created_at",
    ],
    order: [["created_at", "ASC"]],
  });
  const history = childStates.concat(state).sort((a, b) => {
    return a.version - b.version;
  });
  return {
    success: true,
    total: history.length,
    states: history,
  };
};

module.exports = {
  listDataSources,
  addDataSource,
  deleteDataSource,
  loadDataFromSource,
  saveResult,
  downloadResult,
  submitResult,
  getSubmissionStatus,
  updateSubmission,
  cancelSubmission,
  updateSourceTypeStatus,
  listDataSourceTypes,
  updateSubmissionStatus,
  listSupportedFileExtensions,
  listSupportedDatabaseTypes,
  listSupportedCharts,
  listTablesOfDatabaseSource,
  listColumnsOfTable,
  listTablesWithColumnsAndCount,
  createInitialProcessingState,
  getInitialStateAsJson,
  previewSelectedColumns,
  getProcessingStateHistory,
};
