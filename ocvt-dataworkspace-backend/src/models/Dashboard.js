const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Dashboard = sequelize.define(
  "Dashboard",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "FK vers Status.id",
    },
    owner_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "Keycloak user_id",
    },
    domain_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "FK vers Domain.id",
    },
    subdomain_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "FK vers SubDomain.id",
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
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
    tableName: "Dashboard",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = Dashboard;
