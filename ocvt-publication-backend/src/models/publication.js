const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Domain = require("./domain");
const SubDomain = require("./subDomain");

const Publication = sequelize.define(
  "Publication",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    format: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    file_path: {
      type: DataTypes.TEXT,
    },
    permissions: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    publication_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    domain_id: {
      type: DataTypes.INTEGER,
      references: {
        model: Domain,
        key: "id",
      },
    },
    sub_domain_id: {
      type: DataTypes.INTEGER,
      references: {
        model: SubDomain,
        key: "id",
      },
    },
    user_id: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    validated_data_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "publications",
    timestamps: false,
  }
);

Publication.belongsTo(Domain, { foreignKey: "domain_id" });
Publication.belongsTo(SubDomain, { foreignKey: "sub_domain_id" });
Domain.hasMany(Publication, { foreignKey: "domain_id" });
SubDomain.hasMany(Publication, { foreignKey: "sub_domain_id" });

module.exports = Publication;
