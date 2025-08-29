const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ItemType = sequelize.define(
  "ItemType",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    default_config: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: "Configuration par défaut pour ce type d'élément",
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
    tableName: "ItemType",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = ItemType;
