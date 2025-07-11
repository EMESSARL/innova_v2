const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DataSources = sequelize.define(
  "DataSources",
  {
    source_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.STRING, // Référence à l'utilisateur (fournie par Authentication Microfrontend)
      allowNull: false,
    },
    source_type: {
      type: DataTypes.ENUM("file", "database", "api"), // Type de source
      allowNull: false,
    },
    source_name: {
      type: DataTypes.STRING, // Nom descriptif (texte)
      allowNull: false,
    },
    metadata: {
      type: DataTypes.JSONB, // Détails de connexion (JSONB)
      allowNull: true,
    },
    is_final: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "DataSources",
    timestamps: true, // Géré automatiquement par Sequelize
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = DataSources;
