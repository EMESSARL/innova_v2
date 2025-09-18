const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Publication = sequelize.define(
  "Publication",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    dashboard_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      comment: "FK vers Dashboard",
    },
    group_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "ID du groupe Keycloak pour la visibilité",
    },
    visibility: {
      type: DataTypes.ENUM("PUBLIC", "PRIVATE", "PROTECTED"),
      allowNull: false,
      defaultValue: "PRIVATE",
    },
    published_at: {
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
    tableName: "Publication",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = Publication;
