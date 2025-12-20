const {
  FinalResults,
  NonFinalSources,
  ProcessingStates,
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
const axios = require("axios");
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

// Fonction utilitaire pour valider et formater les métadonnées API
const validateAndFormatApiMetadata = async (metadata) => {
  if (!metadata) {
    throw new Error('Les détails de connexion sont requis pour le type "api"');
  }

  const {
    url,
    method = "GET",
    headers = {},
    credentials,
    queryParams = {},
    body = null,
    timeout = null,
    responseFormat = null,
  } = metadata;

  // Validation de l'URL (requis)
  if (!url) {
    throw new Error("L'URL est requise pour une source de type api");
  }
  try {
    new URL(url);
  } catch {
    throw new Error("L'URL fournie est invalide");
  }

  // Validation de la méthode HTTP
  const validMethods = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ];
  const upperMethod = method.toUpperCase();
  if (!validMethods.includes(upperMethod)) {
    throw new Error(
      `Méthode HTTP invalide. Méthodes acceptées : ${validMethods.join(", ")}`
    );
  }

  // Validation des credentials (optionnel)
  if (credentials) {
    const hasBasicAuth = credentials.username && credentials.password;
    const hasApiKey = credentials.api_key;
    const hasBearerToken = credentials.bearer_token;
    const hasCustomAuth = credentials.custom; // Pour des cas d'authentification personnalisés

    if (!hasBasicAuth && !hasApiKey && !hasBearerToken && !hasCustomAuth) {
      throw new Error(
        "Les credentials doivent inclure username/password, api_key, bearer_token, ou custom"
      );
    }
  }

  // Validation du timeout (optionnel, doit être un nombre positif)
  if (timeout !== null && timeout !== undefined) {
    if (typeof timeout !== "number" || timeout <= 0) {
      throw new Error(
        "Le timeout doit être un nombre positif en millisecondes"
      );
    }
  }

  // Validation du format de réponse (optionnel)
  if (responseFormat !== null && responseFormat !== undefined) {
    const validFormats = ["json", "xml", "csv"];
    if (!validFormats.includes(responseFormat.toLowerCase())) {
      throw new Error(
        `Format de réponse invalide. Formats acceptés : ${validFormats.join(
          ", "
        )}`
      );
    }
  }

  // Test de connexion à l'API avant de sauvegarder
  const testMetadata = {
    url,
    method: upperMethod,
    headers,
    credentials,
    queryParams,
    timeout: timeout || 10000, // Utiliser le timeout fourni ou 10s par défaut
  };
  await testApiConnection(testMetadata);

  // Construction de l'objet metadata à stocker
  const metadataToStore = {
    url,
    method: upperMethod,
    headers: Object.keys(headers).length > 0 ? headers : null,
    credentials: credentials ? encrypt(JSON.stringify(credentials)) : null,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : null,
    body: body !== null && body !== undefined ? body : null,
    timeout: timeout || null,
    responseFormat: responseFormat || null,
  };

  return metadataToStore;
};

const BUCKET_NAME = process.env.MINIO_BUCKET;
const SUPPORTED_SPREADSHEET_FORMATS = ["xls", "xlsx"];
const SUPPORTED_CSV_FORMATS = ["csv", "txt"];
const FLOAT_REGEX = /^-?\d+(\.\d+)?$/;

const stripBom = (value) => {
  if (!value || value.length === 0) return value;
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
};

const inferColumnType = (values = []) => {
  const cleaned = values
    .map((value) => (typeof value === "string" ? value.trim() : value))
    .filter((value) => value !== null && value !== undefined && value !== "");

  if (cleaned.length === 0) {
    return "text";
  }

  const isBoolean = cleaned.every((value) => {
    if (typeof value === "boolean") return true;
    const lower = String(value).toLowerCase();
    return ["true", "false", "1", "0", "yes", "no", "oui", "non"].includes(
      lower
    );
  });
  if (isBoolean) return "boolean";

  const isInteger = cleaned.every((value) => {
    if (typeof value === "number") return Number.isInteger(value);
    const num = Number(value);
    return !Number.isNaN(num) && Number.isInteger(num);
  });
  if (isInteger) return "integer";

  const isDate = cleaned.every((value) => {
    if (value instanceof Date) return !Number.isNaN(value.getTime());
    if (typeof value !== "string") return false;
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed);
  });
  if (isDate) return "date";

  const isFloat = cleaned.every((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") {
      return FLOAT_REGEX.test(value);
    }
    return false;
  });
  if (isFloat) return "float";

  return "text";
};

const buildColumnsSchema = (rows = [], fallbackHeaders = []) => {
  let columnNames =
    rows.length > 0 ? Object.keys(rows[0]) : fallbackHeaders.filter(Boolean);
  columnNames = columnNames.map((name, index) =>
    name && name !== "" ? name : `column_${index + 1}`
  );

  return columnNames.map((name, index) => {
    const values = rows.map((row) => row[name]);
    return {
      name,
      type: inferColumnType(values),
    };
  });
};

const getFileSourceDetails = async (userId, sourceId) => {
  let sourceRecord = await FinalResults.findOne({
    where: { final_result_id: sourceId, user_id: userId },
  });

  if (sourceRecord) {
    if (sourceRecord.result_type !== "file") {
      throw new Error("La source demandée n'est pas un fichier");
    }
    const metadata = sourceRecord.metadata || {};
    if (!metadata.file_path || !metadata.fileFormat) {
      throw new Error("Métadonnées de fichier incomplètes");
    }
    return {
      source_id: sourceRecord.final_result_id,
      source_name: sourceRecord.result_name,
      metadata,
      fileFormat: metadata.fileFormat.toLowerCase(),
    };
  }

  sourceRecord = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId, user_id: userId },
  });

  if (!sourceRecord || sourceRecord.source_type !== "file") {
    throw new Error("Source de données non trouvée ou non autorisée");
  }
  const metadata = sourceRecord.metadata || {};
  if (!metadata.file_path || !metadata.fileFormat) {
    throw new Error("Métadonnées de fichier incomplètes");
  }
  return {
    source_id: sourceRecord.non_final_source_id,
    source_name: sourceRecord.source_name,
    metadata,
    fileFormat: metadata.fileFormat.toLowerCase(),
  };
};

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
      metadataToStore = await validateAndFormatApiMetadata(metadata);
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
      nonFinalSource = await NonFinalSources.create({
        user_id: userId,
        source_type: sourceType,
        source_name: sourceName,
        metadata: metadataToStore,
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
        metadata: metadataToStore,
      });
    } else if (sourceType === "api") {
      metadataToStore = await validateAndFormatApiMetadata(metadata);
      nonFinalSource = await NonFinalSources.create({
        user_id: userId,
        source_type: sourceType,
        source_name: sourceName,
        metadata: metadataToStore,
      });
    }
    return {
      success: true,
      data: { non_final_source_id: nonFinalSource.non_final_source_id },
      message: "Source non-finale ajoutée avec succès",
    };
  }
};

// Supprimer une source de données
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

// Charger les données d'une source spécifique
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
          parsedData = JSON.parse(fileData.toString("utf-8"));
          break;
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
      parsedData = JSON.parse(fileData.toString("utf-8"));
      break;
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

const getFileForView = async (source_id, userId) => {
  const finalSource = await FinalResults.findByPk(source_id);
  if (!finalSource) {
    throw new Error("Source de données non trouvée");
  }

  // Vérifier l'autorisation d'accès
  if (finalSource.user_id !== userId) {
    throw new Error("Accès non autorisé à cette source");
  }

  if (finalSource.result_type === "file" && finalSource.metadata?.file_path) {
    try {
      // Générer une URL pour le fichier (valide pendant 1 heure)
      const presignedUrl = await minioClient.presignedUrl(
        "GET",
        BUCKET_NAME,
        finalSource.metadata.file_path,
        3600
      );
      return {
        success: true,
        url: presignedUrl,
      };
    } catch (error) {
      throw new Error("Fichier non trouvé dans le système de fichiers");
    }
  } else {
    throw new Error("Cette source ne contient pas de fichier");
  }
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

// Teste la connexion à une API
const testApiConnection = async (metadata) => {
  const {
    url,
    method = "GET",
    headers = {},
    credentials,
    queryParams = {},
    timeout = 10000, // Timeout par défaut de 10 secondes
  } = metadata;

  // Configuration de base pour axios
  const config = {
    method: method.toUpperCase(),
    url,
    timeout: timeout,
    validateStatus: (status) => status < 500, // Accepter les codes < 500 (même 404 est OK, ça signifie que l'API répond)
  };

  // Ajouter les query params si présents
  if (Object.keys(queryParams).length > 0) {
    config.params = queryParams;
  }

  // Construire les headers
  const requestHeaders = { ...headers };

  // Gérer l'authentification selon le type
  if (credentials) {
    if (credentials.username && credentials.password) {
      // Authentification basique
      const auth = Buffer.from(
        `${credentials.username}:${credentials.password}`
      ).toString("base64");
      requestHeaders["Authorization"] = `Basic ${auth}`;
    } else if (credentials.api_key) {
      // Clé API - peut être dans un header personnalisé ou Authorization
      // On essaie d'abord X-API-Key, sinon Authorization
      if (credentials.api_key_header) {
        requestHeaders[credentials.api_key_header] = credentials.api_key;
      } else {
        requestHeaders["X-API-Key"] = credentials.api_key;
      }
    } else if (credentials.bearer_token) {
      // Token Bearer
      requestHeaders["Authorization"] = `Bearer ${credentials.bearer_token}`;
    } else if (credentials.custom) {
      // Authentification personnalisée - on ajoute directement les headers personnalisés
      if (typeof credentials.custom === "object") {
        Object.assign(requestHeaders, credentials.custom);
      }
    }
  }

  config.headers = requestHeaders;

  // Pour le test de connexion, on utilise HEAD si la méthode originale est HEAD,
  // sinon on utilise GET pour éviter de modifier des données (POST/PUT/DELETE)
  // Cela permet de tester la connexion sans effectuer d'opération potentiellement destructrice
  const originalMethod = method.toUpperCase();
  const testMethod = originalMethod === "HEAD" ? "HEAD" : "GET";
  config.method = testMethod;

  try {
    const response = await axios(config);
    // Si on obtient une réponse (même avec un code d'erreur 4xx), l'API est accessible
    // Les codes 5xx indiquent un problème serveur, mais l'API répond quand même
    return true;
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      throw new Error(
        "Connexion à l'API impossible : le serveur refuse la connexion. Vérifiez l'URL."
      );
    } else if (err.code === "ENOTFOUND") {
      throw new Error(
        "Connexion à l'API impossible : le domaine n'a pas été trouvé. Vérifiez l'URL."
      );
    } else if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
      throw new Error(
        `Connexion à l'API impossible : timeout après ${timeout}ms. L'API ne répond pas dans les temps.`
      );
    } else if (err.response) {
      // L'API a répondu mais avec une erreur
      // Si c'est une erreur d'authentification (401, 403), on le signale
      if (err.response.status === 401) {
        throw new Error(
          "Connexion à l'API impossible : authentification échouée (401). Vérifiez vos credentials."
        );
      } else if (err.response.status === 403) {
        throw new Error(
          "Connexion à l'API impossible : accès refusé (403). Vérifiez vos permissions."
        );
      } else {
        // Autres erreurs HTTP - l'API répond mais avec une erreur
        // On considère que c'est OK pour le test de connexion
        return true;
      }
    } else {
      throw new Error(
        `Connexion à l'API impossible : ${err.message || "erreur inconnue"}`
      );
    }
  }
};

// Récupère les données d'une API pour prévisualisation ou import
const fetchApiData = async (metadata, limit = null, offset = 0) => {
  const {
    url,
    method = "GET",
    headers = null,
    credentials: encryptedCredentials,
    queryParams = null,
    body = null,
    timeout = 10000,
    responseFormat = "json",
  } = metadata;

  // Déchiffrer les credentials si présents
  let credentials = null;
  if (encryptedCredentials) {
    try {
      const decryptedStr =
        typeof encryptedCredentials === "object"
          ? decrypt(encryptedCredentials)
          : encryptedCredentials;
      credentials = JSON.parse(decryptedStr);
    } catch (err) {
      throw new Error(
        "Erreur lors du déchiffrement des credentials : " + err.message
      );
    }
  }

  // Configuration de base pour axios
  const config = {
    method: method.toUpperCase(),
    url,
    timeout: timeout || 10000,
    validateStatus: (status) => status >= 200 && status < 300, // Accepter seulement les codes 2xx
  };

  // Ajouter les query params si présents
  if (queryParams && Object.keys(queryParams).length > 0) {
    config.params = queryParams;
  }

  // Construire les headers
  const requestHeaders = headers ? { ...headers } : {};

  // Gérer l'authentification selon le type
  if (credentials) {
    if (credentials.username && credentials.password) {
      // Authentification basique
      const auth = Buffer.from(
        `${credentials.username}:${credentials.password}`
      ).toString("base64");
      requestHeaders["Authorization"] = `Basic ${auth}`;
    } else if (credentials.api_key) {
      // Clé API
      if (credentials.api_key_header) {
        requestHeaders[credentials.api_key_header] = credentials.api_key;
      } else {
        requestHeaders["X-API-Key"] = credentials.api_key;
      }
    } else if (credentials.bearer_token) {
      // Token Bearer
      requestHeaders["Authorization"] = `Bearer ${credentials.bearer_token}`;
    } else if (credentials.custom) {
      // Authentification personnalisée
      if (typeof credentials.custom === "object") {
        Object.assign(requestHeaders, credentials.custom);
      }
    }
  }

  config.headers = requestHeaders;

  // Ajouter le body si présent (pour POST, PUT, PATCH)
  if (body !== null && body !== undefined) {
    if (typeof body === "object") {
      // Si c'est un objet, on le stringify en JSON
      config.data = body;
      if (!requestHeaders["Content-Type"]) {
        requestHeaders["Content-Type"] = "application/json";
      }
    } else {
      config.data = body;
    }
  }

  try {
    const response = await axios(config);

    // Parser la réponse selon le format
    let dataRows = [];
    const responseData = response.data;
    const format = (responseFormat || "json").toLowerCase();

    if (format === "json") {
      // Si la réponse est déjà un array, l'utiliser directement
      if (Array.isArray(responseData)) {
        dataRows = responseData;
      } else if (typeof responseData === "object") {
        // Si c'est un objet, chercher une propriété qui contient un array
        // (cas courant : { data: [...], results: [...], items: [...] })
        const possibleKeys = ["data", "results", "items", "records", "rows"];
        let found = false;
        for (const key of possibleKeys) {
          if (responseData[key] && Array.isArray(responseData[key])) {
            dataRows = responseData[key];
            found = true;
            break;
          }
        }
        // Si aucune clé standard n'est trouvée, convertir l'objet en array avec un seul élément
        if (!found) {
          dataRows = [responseData];
        }
      } else {
        throw new Error(
          "Format de réponse JSON invalide : réponse non structurée"
        );
      }
    } else if (format === "xml") {
      // Parser le XML
      const parser = new xml2js.Parser();
      const parsed = await parser.parseStringPromise(
        typeof responseData === "string"
          ? responseData
          : JSON.stringify(responseData)
      );
      // Convertir le XML en array d'objets (structure dépend de l'API)
      // On essaie de trouver un array dans la structure XML
      dataRows = flattenXml(parsed);
    } else if (format === "csv") {
      // Parser le CSV
      const csvString =
        typeof responseData === "string"
          ? responseData
          : JSON.stringify(responseData);
      const parsed = Papa.parse(csvString, { header: true });
      dataRows = parsed.data || [];
      // } else if (format === "text") {
      //   // Pour le texte, créer un objet avec une seule colonne "value"
      //   const textString =
      //     typeof responseData === "string"
      //       ? responseData
      //       : JSON.stringify(responseData);
      //   dataRows = [{ value: textString }];
    } else {
      throw new Error(`Format de réponse non supporté : ${format}`);
    }

    // Appliquer limit et offset si spécifiés
    if (limit !== null && limit !== undefined) {
      dataRows = dataRows.slice(offset, offset + limit);
    } else if (offset > 0) {
      dataRows = dataRows.slice(offset);
    }

    return dataRows;
  } catch (err) {
    if (err.response) {
      throw new Error(
        `Erreur API (${err.response.status}): ${
          err.response.statusText || err.message
        }`
      );
    } else if (err.code === "ECONNREFUSED") {
      throw new Error("Connexion à l'API refusée. Vérifiez l'URL.");
    } else if (err.code === "ENOTFOUND") {
      throw new Error("Domaine de l'API introuvable. Vérifiez l'URL.");
    } else if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
      throw new Error(`Timeout lors de la connexion à l'API (${timeout}ms).`);
    } else {
      throw new Error(
        `Erreur lors de la récupération des données de l'API : ${err.message}`
      );
    }
  }
};

// Récupère les données d'une source API (wrapper qui récupère la source et appelle fetchApiData)
const fetchApiDataFromSource = async (
  userId,
  sourceId,
  limit = null,
  offset = 0
) => {
  // Récupérer la source non-finale
  const source = await NonFinalSources.findOne({
    where: { non_final_source_id: sourceId, user_id: userId },
  });

  if (!source) {
    throw new Error("Source non trouvée ou non autorisée");
  }

  if (source.source_type !== "api") {
    throw new Error("Cette source n'est pas de type API");
  }

  const metadata = source.metadata;
  if (!metadata) {
    throw new Error("Métadonnées de l'API manquantes");
  }

  // Récupérer les données via fetchApiData
  const dataRows = await fetchApiData(metadata, limit, offset);

  // Découvrir les colonnes disponibles depuis la première ligne
  const columnsAvailable =
    dataRows.length > 0 ? Object.keys(dataRows[0] || {}) : [];

  return {
    success: true,
    source_id: sourceId,
    source_name: source.source_name,
    columns: columnsAvailable,
    data: dataRows,
    limit: limit || dataRows.length,
    offset: offset,
    total: dataRows.length,
  };
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

// Lister les tables d'une source de base de données
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

// Lister les colonnes d'une table d'une source de base de données
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
  sheetName = null,
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
  if (sheetName) transformationParameters.sheet_name = sheetName;

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
      // Utiliser la feuille spécifiée ou la première par défaut
      const targetSheetName = sheetName || workbook.SheetNames[0];

      // Vérifier que la feuille existe
      if (!workbook.SheetNames.includes(targetSheetName)) {
        throw new Error(
          `Feuille "${targetSheetName}" non trouvée dans le fichier Excel. Feuilles disponibles : ${workbook.SheetNames.join(
            ", "
          )}`
        );
      }

      const sheet = workbook.Sheets[targetSheetName];
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
  } else if (sourceType === "api") {
    // Pour les API, récupérer toutes les données
    let allDataRows = await fetchApiData(metadata);

    if (!allDataRows || allDataRows.length === 0) {
      throw new Error("Aucune donnée trouvée dans la réponse de l'API");
    }

    // Découvrir les colonnes disponibles depuis la première ligne
    const availableCols = Object.keys(allDataRows[0] || {});
    if (availableCols.length === 0) {
      throw new Error("Aucune colonne trouvée dans les données de l'API");
    }

    // Vérifier que toutes les colonnes demandées existent
    for (const col of columns) {
      if (!availableCols.includes(col)) {
        throw new Error(
          `Colonne non trouvée dans les données de l'API : ${col}`
        );
      }
    }

    // Filtrer les données pour ne garder que les colonnes sélectionnées
    dataRows = allDataRows.map((row) => {
      const filtered = {};
      columns.forEach((col) => {
        filtered[col] = row[col];
      });
      return filtered;
    });
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
  } else if (sourceType === "api") {
    // Pour les API, récupérer suffisamment de données pour découvrir les colonnes
    // et avoir les données nécessaires pour offset/limit
    // On récupère max(limit + offset, 100) pour être sûr d'avoir assez de données
    const fetchLimit = Math.max(limit + offset, 100);
    let allDataRows = await fetchApiData(metadata, fetchLimit, 0);

    if (!allDataRows || allDataRows.length === 0) {
      throw new Error("Aucune donnée trouvée dans la réponse de l'API");
    }

    // Découvrir les colonnes disponibles depuis la première ligne
    columnsAvailable = Object.keys(allDataRows[0] || {});
    if (columnsAvailable.length === 0) {
      throw new Error("Aucune colonne trouvée dans les données de l'API");
    }

    // Vérifier que toutes les colonnes demandées existent
    for (const col of columns) {
      if (!columnsAvailable.includes(col)) {
        throw new Error(
          `Colonne non trouvée dans les données de l'API : ${col}`
        );
      }
    }

    // Filtrer les données pour ne garder que les colonnes sélectionnées
    // et appliquer offset/limit
    dataRows = allDataRows
      .map((row) => {
        const filtered = {};
        columns.forEach((col) => {
          filtered[col] = row[col];
        });
        return filtered;
      })
      .slice(offset, offset + limit);
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

// Récupère le contenu d'un état sous forme de JSON
const getStateContentsAsJson = async ({
  // userId,
  stateId,
  // limit = 100,
  // offset = 0,
}) => {
  // Chercher l'état par son ID
  const state = await ProcessingStates.findOne({
    where: { state_id: stateId },
    order: [["created_at", "DESC"]],
  });
  if (!state) throw new Error("Aucun état trouvé pour cet ID");
  if (!state.file_path) throw new Error("Aucun fichier associé à cet état");
  // Récupérer le fichier depuis MinIO
  const fileStream = await minioClient.getObject(BUCKET_NAME, state.file_path);
  const fileBuffer = await streamToBuffer(fileStream);
  let data = [];
  let columns = [];
  let table = state.transformation_parameters?.table || null;
  let total = 0;
  // Détection du format
  const format = state.file_format ? state.file_format.toLowerCase() : "csv";
  if (format === "csv" || format === "txt") {
    let csvString = fileBuffer.toString("utf8");
    if (csvString.charCodeAt(0) === 0xfeff) csvString = csvString.slice(1);
    const parsed = Papa.parse(csvString, { header: true });
    data = parsed.data || [];
    columns = parsed.meta.fields || [];
    total = data.length;
  } else if (format === "excel" || format === "xls" || format === "xlsx") {
    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    data = XLSX.utils.sheet_to_json(sheet);
    columns = data.length > 0 ? Object.keys(data[0]) : [];
    total = data.length;
  } else if (format === "json" || format === "geojson") {
    data = JSON.parse(fileBuffer.toString("utf8"));
    if (Array.isArray(data)) {
      columns = data.length > 0 ? Object.keys(data[0]) : [];
      total = data.length;
    } else if (data && typeof data === "object") {
      columns = Object.keys(data);
      total = 1;
      data = [data];
    } else {
      columns = [];
      total = 0;
      data = [];
    }
  } else {
    throw new Error("Format de fichier non supporté pour la lecture de l'état");
  }
  return {
    success: true,
    state_id: state.state_id,
    table,
    columns,
    data,
    total,
  };
};

// Récupère l'historique complet des traitements pour une source non-finale
const getFullProcessingHistory = async (nonFinalSourceId) => {
  // Récupérer tous les états initiaux (version 0)
  const initialStates = await ProcessingStates.findAll({
    where: { non_final_source_id: nonFinalSourceId, version: 0 },
    order: [["created_at", "ASC"]],
  });

  // Fonction récursive pour récupérer les enfants
  const fetchChildren = async (parentStateId) => {
    const children = await ProcessingStates.findAll({
      where: { parent_state_id: parentStateId },
      order: [["created_at", "ASC"]],
    });
    return Promise.all(
      children.map(async (child) => ({
        state_id: child.state_id,
        version: child.version,
        transformation_type: child.transformation_type,
        transformation_parameters: child.transformation_parameters,
        created_at: child.created_at,
        children: await fetchChildren(child.state_id),
      }))
    );
  };

  // Construire l'arbre pour chaque état initial
  const history = await Promise.all(
    initialStates.map(async (state) => ({
      state_id: state.state_id,
      version: state.version,
      transformation_type: state.transformation_type,
      transformation_parameters: state.transformation_parameters,
      created_at: state.created_at,
      children: await fetchChildren(state.state_id),
    }))
  );

  return { success: true, history };
};

const getFileStructure = async ({ userId, sourceId }) => {
  const fileSource = await getFileSourceDetails(userId, sourceId);
  const { metadata, fileFormat, source_name } = fileSource;
  const fileStream = await minioClient.getObject(
    BUCKET_NAME,
    metadata.file_path
  );
  const fileBuffer = await streamToBuffer(fileStream);

  if (SUPPORTED_SPREADSHEET_FORMATS.includes(fileFormat)) {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
      const headerRows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: null,
        blankrows: false,
      });
      const columns = buildColumnsSchema(rows, headerRows[0] || []);
      return {
        sheet_name: sheetName,
        columns,
        row_count: rows.length,
      };
    });

    return {
      success: true,
      data: {
        source_id: fileSource.source_id,
        source_name,
        sheets,
      },
    };
  }

  if (SUPPORTED_CSV_FORMATS.includes(fileFormat)) {
    const csvString = stripBom(fileBuffer.toString("utf8"));
    const parsed = Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
    });
    const rows = parsed.data || [];
    const columns = buildColumnsSchema(rows, parsed.meta.fields || []);
    const sheetName =
      metadata.original_filename || `${source_name || "Sheet"} (CSV)`;

    return {
      success: true,
      data: {
        source_id: fileSource.source_id,
        source_name,
        sheets: [
          {
            sheet_name: sheetName,
            columns,
            row_count: rows.length,
          },
        ],
      },
    };
  }

  throw new Error("Format de fichier non supporté pour la structure");
};

const getSheetData = async ({
  userId,
  sourceId,
  sheetName,
  limit = 100,
  offset = 0,
}) => {
  const fileSource = await getFileSourceDetails(userId, sourceId);
  const { metadata, fileFormat, source_name } = fileSource;

  const fileStream = await minioClient.getObject(
    BUCKET_NAME,
    metadata.file_path
  );
  const fileBuffer = await streamToBuffer(fileStream);
  const safeLimit = Number.isInteger(limit) ? limit : 100;
  const safeOffset = Number.isInteger(offset) ? offset : 0;

  if (SUPPORTED_SPREADSHEET_FORMATS.includes(fileFormat)) {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames || [];
    if (sheetNames.length === 0) {
      throw new Error("Aucune feuille détectée dans ce fichier");
    }
    const selectedSheet = sheetName || sheetNames[0];
    if (!sheetNames.includes(selectedSheet)) {
      throw new Error("Feuille demandée introuvable dans ce fichier");
    }
    const worksheet = workbook.Sheets[selectedSheet];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    const headerRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });
    const columns = buildColumnsSchema(rows, headerRows[0] || []);
    const total = rows.length;
    const paginated = rows.slice(safeOffset, safeOffset + safeLimit);

    return {
      success: true,
      data: {
        source_id: fileSource.source_id,
        source_name,
        sheet_name: selectedSheet,
        columns,
        rows: paginated,
        pagination: {
          limit: safeLimit,
          offset: safeOffset,
          total,
        },
      },
    };
  }

  if (SUPPORTED_CSV_FORMATS.includes(fileFormat)) {
    const csvString = stripBom(fileBuffer.toString("utf8"));
    const parsed = Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
    });
    const rows = parsed.data || [];
    const columns = buildColumnsSchema(rows, parsed.meta.fields || []);
    const total = rows.length;
    const paginated = rows.slice(safeOffset, safeOffset + safeLimit);
    const effectiveSheetName =
      sheetName ||
      metadata.original_filename ||
      `${source_name || "Sheet"} (CSV)`;

    return {
      success: true,
      data: {
        source_id: fileSource.source_id,
        source_name,
        sheet_name: effectiveSheetName,
        columns,
        rows: paginated,
        pagination: {
          limit: safeLimit,
          offset: safeOffset,
          total,
        },
      },
    };
  }

  throw new Error("Format de fichier non supporté pour la lecture de données");
};

module.exports = {
  listDataSources,
  addDataSource,
  deleteDataSource,
  loadDataFromSource,
  updateSourceTypeStatus,
  listDataSourceTypes,
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
  getStateContentsAsJson,
  getFullProcessingHistory,
  getFileForView,
  fetchApiData,
  fetchApiDataFromSource,
  getFileStructure,
  getSheetData,
};
