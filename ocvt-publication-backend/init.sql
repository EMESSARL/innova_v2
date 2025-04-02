CREATE TABLE IF NOT EXISTS public.domains
(
    id SERIAL PRIMARY KEY,
    name text COLLATE pg_catalog."default" NOT NULL
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.domains
    OWNER to ocvt_publication_user;


CREATE TABLE IF NOT EXISTS public.sub_domains
(
    id SERIAL PRIMARY KEY,
    name text COLLATE pg_catalog."default" NOT NULL,
    domain_id integer,
    CONSTRAINT sub_domains_domain_id_fkey FOREIGN KEY (domain_id)
        REFERENCES public.domains (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.sub_domains
    OWNER to ocvt_publication_user;


CREATE TABLE IF NOT EXISTS public.publications
(
    id SERIAL PRIMARY KEY,
    title text COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    format text COLLATE pg_catalog."default" NOT NULL,
    file_path text COLLATE pg_catalog."default",
    permissions text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL,
    publication_date timestamp without time zone NOT NULL,
    domain_id integer,
    sub_domain_id integer,
    user_id text COLLATE pg_catalog."default" NOT NULL,
    validated_data_id integer NOT NULL,
    CONSTRAINT publications_domain_id_fkey FOREIGN KEY (domain_id)
        REFERENCES public.domains (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT publications_sub_domain_id_fkey FOREIGN KEY (sub_domain_id)
        REFERENCES public.sub_domains (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.publications
    OWNER to ocvt_publication_user;

