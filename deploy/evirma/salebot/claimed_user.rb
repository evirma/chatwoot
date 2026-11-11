require 'csv'
require 'json'
require 'optparse'

# EVIRMA: one-off step after the SaleBot import. SaleBot's evirma_user_id came from an extension link and was
# never verified, so it goes only into the claimed_evirma_user_id attribute that the support panel shows as
# unconfirmed; the contact identifier (verified identity) is never touched.
class EvirmaSalebotClaimedUser
  ACCOUNT_ID = 1
  ATTRIBUTE = 'claimed_evirma_user_id'.freeze
  UUID = /\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/

  def self.run(argv = ARGV, output: $stdout)
    options = { mappings: [], apply: false }
    args = argv.dup
    args.shift if args.first == '--'
    OptionParser.new do |cli|
      cli.banner = 'rails runner deploy/evirma/salebot/claimed_user.rb -- --extra FILE --mapping FILE... --users FILE [--apply]'
      cli.on('--extra FILE') { |value| options[:extra] = value }
      cli.on('--mapping FILE') { |value| options[:mappings] << value }
      cli.on('--users FILE') { |value| options[:users] = value }
      cli.on('--apply') { options[:apply] = true }
    end.parse!(args)
    raise OptionParser::MissingArgument, '--extra, --mapping, --users' unless complete?(options)

    new(**options, output: output).perform
  end

  def self.complete?(options)
    options[:extra] && options[:mappings].any? && options[:users]
  end

  # extra: clients-extra.jsonl ({"id", "variables": {"evirma_user_id"}}); mappings: import mapping CSVs;
  # users: Evirma user ids that exist in crm.user_auth, one per line (read from the prod database beforehand).
  def initialize(extra:, mappings:, users:, apply:, output:)
    @extra = extra
    @mappings = mappings
    @users = users
    @apply = apply
    @output = output
  end

  def perform
    account = Account.find(ACCOUNT_ID)
    users = File.readlines(@users, chomp: true).to_set { |line| line.strip.downcase }
    stats = Hash.new(0)
    claims(stats).each do |client_id, user_id|
      contact_id = contacts[client_id]
      stats[contact_id ? link(account, contact_id, user_id, users) : 'skipped_not_imported'] += 1
    end
    @output.puts JSON.generate(mode: @apply ? 'apply' : 'dry-run', totals: stats)
    stats
  end

  private

  def claims(stats)
    File.foreach(@extra).filter_map do |line|
      record = JSON.parse(line)
      variables = record['variables']
      stats['extra_without_variables'] += 1 unless variables.is_a?(Hash)
      user_id = variables.is_a?(Hash) ? variables['evirma_user_id'].to_s.strip.downcase : ''
      [record['id'].to_s, user_id] unless user_id.empty?
    end
  end

  def contacts
    @contacts ||= @mappings.each_with_object({}) do |path, result|
      CSV.foreach(path, headers: true) do |row|
        result[row['salebot_client_id']] = row['contact_id'].to_i if row['status'] == 'imported' && row['contact_id'].present?
      end
    end
  end

  def link(account, contact_id, user_id, users)
    return 'skipped_bad_user_id' unless UUID.match?(user_id)
    return 'skipped_unknown_user' unless users.include?(user_id)

    contact = account.contacts.find_by(id: contact_id)
    return 'skipped_missing_contact' unless contact

    current = contact.custom_attributes[ATTRIBUTE]
    return 'already_set' if current == user_id
    return 'skipped_other_claim' if current.present?

    contact.update!(custom_attributes: contact.custom_attributes.merge(ATTRIBUTE => user_id)) if @apply
    'set'
  end
end

EvirmaSalebotClaimedUser.run if $PROGRAM_NAME == __FILE__
