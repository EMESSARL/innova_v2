const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Validation = sequelize.define(
  "Validation",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    dashboard_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "FK vers Dashboard",
    },
    validator_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "Keycloak user_id du validateur",
    },
    action: {
      type: DataTypes.ENUM("SUBMIT", "VALIDATE", "REJECT", "REQUEST_UPDATE"),
      allowNull: false,
    },
    comments: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "Validation",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = Validation;
